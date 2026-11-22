/**
 * ScamShield on-device scam-message classifier.
 *
 * WHAT THIS IS
 *   A lightweight, explainable BASELINE: a logistic model over ~26
 *   hand-crafted, human-readable features that capture the patterns of
 *   mobile-money fraud seen in Kenya (English, Swahili and Sheng). Every weight
 *   below was set by hand and is documented next to its feature; nothing was
 *   learned from data. It is NOT a trained neural model, and it will miss
 *   novel scam scripts that use none of these patterns.
 *
 * WHY IT LOOKS LIKE THIS
 *   - Privacy: it runs entirely in the browser. The message is never sent
 *     anywhere — no network calls, no telemetry, no dependencies.
 *   - Explainability: the result lists every feature that fired with its
 *     weight, so the UI can show the user WHY a message was flagged (and
 *     teach them the pattern), instead of an opaque score.
 *   - Low-end phones: pure regex + arithmetic. Not yet benchmarked on
 *     phones.
 *
 * MODEL
 *   z = BIAS + sum(weight_i for every feature i that fired)
 *   score = 1 / (1 + e^-z)
 *   label = 'scam' if score >= SCAM_THRESHOLD,
 *           'suspicious' if score >= SUSPICIOUS_THRESHOLD, else 'likely-safe'.
 *   With BIAS = -3 a message with no signals scores ~0.05. Roughly: a PIN
 *   request alone -> 'suspicious'; a fake confirmation alone, or one strong
 *   plus supporting signals -> 'scam'. Negative-weight features
 *   (official sender, "do not share your PIN" warnings) pull legitimate
 *   service messages down.
 *
 * ROADMAP
 *   Replace / ensemble this baseline with a small on-device model (e.g. a
 *   distilled multilingual transformer exported to ONNX and run with
 *   transformers.js / onnxruntime-web) trained on community-labelled messages.
 *   Labels can be bootstrapped from the anonymous, Sybil-resistant ScamShield
 *   report registry on Midnight (number-level reports) plus opt-in, locally
 *   redacted message samples. The explainable features here remain useful as
 *   a fallback and as "reasons" shown next to a model score.
 */

import { extractPhoneNumbers, normalizeKenyanMsisdn } from './phone';

// ---------------------------------------------------------------------------
// Public types and constants
// ---------------------------------------------------------------------------

export type ScamLabel = 'scam' | 'suspicious' | 'likely-safe';

export interface ScamSignal {
  /** Stable feature id, e.g. "pin-request". */
  id: string;
  /** Human-readable explanation suitable for showing to the user. */
  description: string;
  /** Logistic weight contributed by this feature (negative = evidence of legitimacy). */
  weight: number;
}

export interface ClassifyOptions {
  /**
   * SMS sender as shown by the phone: an alphanumeric sender ID ("MPESA",
   * "EQUITYBANK") or a phone number ("0712345678", "+254712345678").
   * Optional — without it the sender-dependent features are weaker.
   */
  sender?: string;
}

export interface ClassificationResult {
  /** Probability-like scam score in [0, 1]. */
  score: number;
  label: ScamLabel;
  /** Only the features that fired, strongest (by |weight|) first. */
  signals: ScamSignal[];
}

/** Intercept of the logistic model: prior that a random message is a scam is low. */
export const BIAS = -3;
/** score >= this -> 'scam'. */
export const SCAM_THRESHOLD = 0.75;
/** score >= this (and < SCAM_THRESHOLD) -> 'suspicious'. */
export const SUSPICIOUS_THRESHOLD = 0.4;

/**
 * The sender field is typed by the user and may be a saved contact name or a
 * spoofed ID, so it is only ever a hint. Confirmations come from MPESA alone.
 */
const OFFICIAL_SENDERS = new Set(['MPESA', 'SAFARICOM']);
/** Shape of an SMS sender ID (short, upper case, no spaces) or a short code. */
const SENDER_ID = /^(?:[A-Z][A-Z0-9_&-]{1,10}|\d{3,6})$/;

/**
 * Publicly documented customer-care mobile numbers that should NOT trigger the
 * fake-customer-care feature. Safaricom care is primarily 100 / 200 (short
 * codes, never matched as mobile numbers anyway) and 0722 000 000.
 */
const KNOWN_CARE_NUMBERS = new Set(['254722000000']);

/** Official domains; brand names appearing in any OTHER domain are look-alikes. */
const OFFICIAL_DOMAINS = [
  'safaricom.co.ke',
  'safaricom.com',
  'kra.go.ke',
  'ecitizen.go.ke',
  'equitybank.co.ke',
  'equitygroupholdings.com',
  'kcbgroup.com',
  'airtelkenya.com',
  'helb.co.ke',
  'equitybankgroup.com',
  'ncbagroup.com',
  'm-pesa.africa',
];
const BRAND_IN_DOMAIN = /(safaricom|m-?pesa|fuliza|(?<![a-z])kra|ecitizen|equity|kcb|airtel|helb|ncba)/;

// ---------------------------------------------------------------------------
// Feature table (id, weight, description). Weights are hand-set; see the
// comment on each for the reasoning. Exported so the UI can render a legend.
// ---------------------------------------------------------------------------

export const FEATURES = {
  // --- Strong scam indicators -------------------------------------------
  /** A confirmation-format text from a personal number is almost certainly forged. */
  'fake-mpesa-confirmation': {
    weight: 4.5,
    description:
      'Looks like an M-Pesa confirmation but was sent from a personal phone number. Real confirmations only come from the "MPESA" sender — check your actual balance before doing anything.',
  },
  /** No legitimate service asks you to send your PIN/OTP to someone. */
  'pin-request': {
    weight: 3.5,
    description:
      'Asks you to send, share or enter your PIN, OTP, password or a verification code. Safaricom, banks and agents never ask for these.',
  },
  /** Classic "prize" bait (umeshinda / you have won / lucky draw / selected). */
  'prize-claim': {
    weight: 2.5,
    description:
      'Claims you have won or been selected for a prize, draw or payout ("umeshinda", "you have won"). Unexpected winnings are a classic scam.',
  },
  /** Advance-fee fraud: pay a small fee to receive a loan/job/prize. */
  'upfront-fee': {
    weight: 2.5,
    description:
      'Asks you to pay a processing/registration/activation fee (or pay "first") before you receive a loan, job, prize or payout.',
  },
  /** "Sent to you by mistake" — the first half of the fake-reversal scam. */
  'mistaken-transfer': {
    weight: 2.0,
    description:
      'Claims money was sent to you by mistake ("kimakosa", "nimekosea kutuma"). Check your real M-Pesa balance/statement — scammers send fake confirmations first.',
  },
  /** Threat of account / SIM / line suspension to create fear. */
  'suspension-threat': {
    weight: 2.0,
    description:
      'Threatens that your account, line, SIM or M-Pesa will be blocked, suspended or closed ("itafungwa") unless you act.',
  },
  /** Second half of the fake-reversal scam. */
  'reversal-request': {
    weight: 1.5,
    description:
      'Asks you to reverse, return or send money back ("rudisha", "ni-reverse"). Genuine mistaken transfers are reversed by Safaricom via 456, not by you.',
  },
  /** Brand name inside a domain that is not the brand's official domain. */
  'lookalike-domain': {
    weight: 1.5,
    description:
      'Contains a link whose address uses a brand name (Safaricom, M-Pesa, KRA, a bank) but is not on our short list of official websites.',
  },
  /** URL shorteners and cheap TLDs hide where a link goes. */
  'shortened-or-suspicious-link': {
    weight: 1.5,
    description:
      'Contains a shortened link (bit.ly, tinyurl…) or a cheap throw-away domain (.xyz, .top, .online…) that hides where it really goes.',
  },
  /** Customer-care claim + an ordinary mobile number in the text. */
  'fake-customer-care': {
    // 2.0 so that "customer care + call this ordinary number" (with
    // call-instruction) reaches at least 'suspicious' on its own.
    weight: 2.0,
    description:
      'Mentions "customer care" / an official agent together with an ordinary mobile number. Safaricom customer care is 100 or 200 — verify numbers on the official website.',
  },
  /** Personal number claiming to be a company. */
  'brand-impersonation': {
    weight: 1.5,
    description:
      'Sent from a personal phone number but speaks in the name of Safaricom, M-Pesa, a bank or a government agency.',
  },
  /** Confirmation format, but from a registered non-M-Pesa sender ID. */
  'confirmation-from-other-sender': {
    weight: 1.5,
    description:
      'Uses M-Pesa confirmation wording but the sender is not "MPESA".',
  },
  /** "Friend in distress / new number" impersonation. */
  'new-number-or-distress': {
    weight: 1.2,
    description:
      'Claims a new number, a stolen phone or an emergency. Scammers impersonate friends and relatives this way — call the person on their known number first.',
  },
  /** Requests for identity data used for SIM-swap and account takeover. */
  'personal-info-request': {
    weight: 1.2,
    description:
      'Asks for your ID number, date of birth, full names or card details, which can be used for SIM-swap or account takeover.',
  },
  /** Pressure tactics. */
  urgency: {
    weight: 1.0,
    description:
      'Uses pressure or a deadline ("haraka", "immediately", "within 24 hours") to stop you from thinking or checking.',
  },
  /** Explicit instruction to call/WhatsApp a phone number. */
  'call-instruction': {
    weight: 1.0,
    description: 'Tells you to call, text or WhatsApp a specific phone number.',
  },
  /** Any link. Weak on its own — plenty of normal messages contain links. */
  link: {
    weight: 1.0,
    description: 'Contains a web link. Do not enter PINs or personal details on linked pages.',
  },
  /** Asking for secrecy isolates the victim. */
  secrecy: {
    weight: 0.8,
    description: 'Asks you to keep it secret or not tell anyone.',
  },
  /** Confirmation wording with no sender information to check. */
  'unverified-confirmation': {
    weight: 0.8,
    description:
      'Looks like an M-Pesa confirmation. Make sure it came from the "MPESA" sender and that your balance really changed.',
  },
  /** Loan / job / limit-increase bait. Weak alone (real lenders advertise too). */
  'loan-or-job-bait': {
    weight: 0.7,
    description: 'Offers a loan, limit increase or job.',
  },
  /** Loan offer AND an instruction to call/text a phone number to get it. */
  'loan-plus-call': {
    weight: 1.0,
    description:
      'Offers a loan and tells you to call or text a phone number to receive it ("umepata mkopo… piga simu"). Real lenders pay out through their app or M-PESA, not via a phone call.',
  },
  /** Promotional words (zawadi, bonus, promo). Weak alone. */
  'promo-language': {
    weight: 0.6,
    description: 'Uses promotion/reward language ("promo", "bonus", "zawadi").',
  },
  /** Asks to send/pay money. Very common in legitimate chat, so weak. */
  'money-request': {
    weight: 0.6,
    description: 'Asks you to send or pay money.',
  },

  // --- Evidence of legitimacy (negative weights) -------------------------
  /** Genuine M-Pesa / Safaricom sender ID. */
  'official-sender': {
    weight: -2.0,
    description:
      'The sender you entered matches the "MPESA"/"Safaricom" sender ID. Sender names can be spoofed, so still check your balance.',
  },
  /** Registered alphanumeric sender IDs (banks, schools, utilities). */
  'registered-sender-id': {
    weight: -1.0,
    description:
      'The sender you entered looks like an organisation\'s sender ID. Sender names can be spoofed.',
  },
  /** Legit OTP/bank messages warn you NOT to share. */
  'security-warning': {
    weight: -1.5,
    description:
      'Warns you NOT to share your PIN/code ("do not share", "usitume PIN"), which is typical of genuine bank and OTP messages.',
  },
} as const satisfies Record<string, { weight: number; description: string }>;

export type FeatureId = keyof typeof FEATURES;

// ---------------------------------------------------------------------------
// Patterns (operate on lower-cased, whitespace-normalised text unless noted)
// ---------------------------------------------------------------------------

/** Sentence-local gap: up to N characters without crossing ., !, ? or newline. */
const GAP = '[^.!?\\n]{0,30}?';

const SECRET_NOUN =
  '(?:pin|otp|one[- ]time (?:password|pin|code)|password|passcode|nambari ya siri|namba ya siri|siri yako|' +
  '(?:verification|security|secret|activation|confirmation|sms|\\d[- ]digit) code|' +
  '(?:this|the|that|hiyo|hii|ile) code|code (?:ya|uliyo\\w*|iliyo\\w*|(?:we|you|that) (?:sent|received|got)))';

/** Verbs for handing a secret to someone (any secret, including codes). */
const SEND_SECRET = new RegExp(
  '\\b(?:tuma|tutumie|nitumie|nipe|tupe|nipatie|tupatie|share|send|give|provide|confirm|reply with|' +
    'tell (?:us|me)|forward|andika)\\b' +
    GAP +
    '\\b' +
    SECRET_NOUN +
    '\\b',
  'g',
);
/** Entering a PIN/password (typically on a linked page). Codes excluded: legit OTPs say "enter the code". */
const ENTER_PIN = new RegExp(
  '\\b(?:enter|input|type|weka)\\b' + GAP + '\\b(?:(?:m-?pesa )?pin|password|nambari ya siri|namba ya siri)\\b',
  'g',
);
/**
 * The phone's own M-PESA payment flow (STK-push prompt, Lipa na M-PESA menu),
 * where "enter your M-PESA PIN" is a normal instruction from merchants.
 */
const ON_PHONE_PAYMENT =
  /\b(?:prompt|stk|lipa na m-?pesa|buy goods|pay ?bill|till (?:number|no)|m-?pesa menu)\b|\*334#/;
/**
 * A code/PIN mentioned first, then a request to pass "it" on ("I sent my 6
 * digit code to your phone. Could you forward it to me?"). May cross one
 * sentence boundary, since the ask usually follows in the next sentence.
 */
const SECRET_FORWARD = new RegExp(
  '\\b' +
    SECRET_NOUN +
    '\\b[^\\n]{0,60}?\\b(?:forward (?:it|that|the code)|send (?:it|that) (?:to me|back)|(?:ni|tu)tumie (?:hiyo|hii|ile)?)',
  'g',
);

const PERSONAL_INFO = new RegExp(
  '\\b(?:tuma|nitumie|tutumie|send|provide|confirm|reply with|share|give|nipe|tupe)\\b' +
    GAP +
    '\\b(?:id number|national id|id no|kitambulisho|date of birth|tarehe ya kuzaliwa|full names?|majina (?:yako )?kamili|card number|cvv|account number)\\b',
  'g',
);

/** Negation immediately before a match ("do not share", "never send", "usitume", "kamwe"). */
const NEGATION_BEFORE = /(?:\bnot|\bnever|n't|\bdont|\bkamwe|\busi\w*)\s+(?:\w+\s+){0,2}$/;

const SECURITY_WARNING =
  /\b(?:do not share|don't share|dont share|never share|do not send|never send|do not give|never give|do not disclose|usitume|usishiriki|usimpe|usimwambie mtu (?:pin|nambari)|will never ask|haitawahi kukuuliza|hatutawahi|hatuwezi kukuuliza)\b/;

const CONFIRMATION_CODE = /\b[A-Z0-9]{10}\s+Confirmed\b/; // case-sensitive, on original text
const CONFIRMATION_WORDING =
  /\b(?:confirmed\.?\s+(?:you have received|ksh|kes)|you have received\s+(?:ksh|kes)|new m-?pesa balance|umepokea\s+(?:ksh|kes)|salio (?:jipya )?la m-?pesa)/;

const MISTAKEN_TRANSFER =
  /\b(?:by mistake|mistakenly|by accident|accidentally|in error|wrongly sent|sent (?:it )?wrongly|wrong (?:number|transaction|transfer)|(?:sent|nimekutumia|nimetuma|nilituma)\b[^.!?\n]{0,25}\bwrong|kimakosa|kwa makosa|nimekosea|nilikosea|nimeteleza|nimetuma vibaya)\b/;
// Swahili "rudisha" (return) in imperative/subjunctive request forms with an
// optional object/subject prefix: rudisha, nirudishie, unirudishie, urudishe,
// turudishie… The indicative future "nitakurudishia" (I'll pay you back) does
// not match.
const REVERSAL_REQUEST =
  /\b(?:reverse|reversal|ni-?reverse|(?:ni|u|tu|uni|utu|m|mni)?rudish(?:a|e|ie)|return (?:it|the money|my money|the funds|the cash)|refund (?:it|me)|send (?:it|the money) back|tuma (?:ile )?pesa yangu)\b/;

const PRIZE_CLAIM =
  /\b(?:umeshinda|mshindi|washindi|you (?:have |'ve )?won|you are (?:a|the|our) (?:lucky )?winner|lucky (?:draw|winner)|jackpot|lottery|bahati nasibu|droo|umechaguliwa|you have been selected|has been selected|selected as (?:a|the|our))\b/;
const PROMO_LANGUAGE =
  /\b(?:zawadi|prize|reward|bonus|promotion|promo|giveaway|free gift|cash ?back)\b/;

const UPFRONT_FEE = [
  /\b(?:processing|registration|activation|clearance|service|application|insurance|verification|delivery|withdrawal|unlocking|facilitation|commitment|booking) (?:fee|charge)s?\b/,
  /\bada ya (?:usajili|usindikaji|maombi|kusajili|kujiandikisha|uanachama|huduma|kuchakata)\b/,
  /\b(?:ya|for) usajili\b/,
  new RegExp(
    '\\b(?:pay|send|(?:u|m|ni|tu|wa)?tum(?:a|e|ie)|lipa|deposit)\\b[^.!?\\n]{0,40}?\\b(?:first|kwanza|ili (?:upate|kupata|upokee|kupokea|kuamilisha)|' +
      'to (?:claim|receive|unlock|activate|release) (?:your|the|it))\\b',
  ),
];

const LOAN_OR_JOB =
  /\b(?:loan (?:of|up to|approved|limit)|instant loan|mkopo (?:wa|hadi|umeidhinishwa)|mikopo|job offer|jobs? available|hiring now|we are hiring|vacanc(?:y|ies)|nafasi za kazi|ajira|(?:fuliza|okoa jahazi|loan) limit|limit (?:yako )?(?:imeongezwa|increased|upgraded)|umehitimu|you (?:have )?qualif(?:ied|y)|eligible for|umeidhinishwa|pre-?approved|salary (?:of )?(?:ksh ?)?\d|without crb)/;

const SUSPENSION_THREAT = [
  /\b(?:account|akaunti|line|laini|sim|sim card|m-?pesa|whatsapp|number|namba)\b[^.!?\n]{0,40}?\b(?:suspend\w*|block\w*|deactivat\w*|disconnect\w*|terminat\w*|frozen|freez\w*|disabl\w*|closed|itafungwa|imefungwa|itazimwa|imezimwa|itasimamishwa|imesimamishwa|itafutwa|itablockiwa)/,
  /\b(?:itafungwa|itazimwa|itasimamishwa|itablockiwa|will be (?:suspended|blocked|closed|deactivated|disconnected|terminated)|to avoid (?:disconnection|suspension|deactivation|being blocked)|kuepuka kufungiwa)\b/,
];

const URGENCY =
  /\b(?:haraka|upesi|sasa hivi|mara moja|immediately|urgent(?:ly)?|asap|right away|act now|call now|reply now|pay now|today only|last chance|final (?:notice|warning)|before midnight|within \d+ ?(?:hours?|hrs?|minutes?|mins?|days?)|ndani ya (?:saa|dakika|masaa|siku)|kabla ya saa|expires? (?:today|tonight|in \d)|leo hii)\b/;

/** Loan offered to YOU ("umepata mkopo", "you qualify for a loan"). */
const LOAN_OFFERED =
  /\b(?:umepata mkopo|umepewa mkopo|mkopo wako|you (?:have )?(?:qualif(?:y|ied)|been approved) for an? (?:\w+ )?loan|your loan (?:of|is) (?:approved|ready))\b/;

const CALL_VERB = /\b(?:call|piga|pigia|nipigie|tupigie|contact|reach|whatsapp|text|sms)\b/g;

const CUSTOMER_CARE =
  /\b(?:customer care|customer service|customer support|huduma kwa wateja|care team|helpline|help desk|call cent(?:er|re)|(?:safaricom|m-?pesa|bank) (?:agent|staff|official|office)|wakala wa m-?pesa|official agent)\b/;

const BRAND_MENTION =
  /\b(?:safaricom|m-?pesa|airtel|kcb|equity|co-?op(?:erative)? bank|ncba|absa|stanbic|family bank|kra|helb|nhif|ecitizen|bank)\b/;

const NEW_NUMBER_OR_DISTRESS =
  /\b(?:namba (?:yangu )?mpya|number mpya|new number|my (?:phone|simu) (?:was|got|has been) stolen|simu yangu (?:imeibiwa|imepotea)|nimepoteza simu|this is my new|niko stuck|i'?m stuck|stranded|(?:i have|i've got|i got|i'?m in|nina|niko na|niko kwa) (?:an? |some )?(?:emergency|dharura)|nimepatwa na dharura)\b/;

const SECRECY =
  /\b(?:usimwambie (?:mtu|yeyote)|usiambie mtu|don'?t tell anyone|do not tell anyone|keep (?:this|it) (?:secret|confidential|between us)|confidential)\b/;

const MONEY_REQUEST =
  /\b(?:(?:u|m|ni|tu|wa)?tum(?:a|e|ie)|tutumie|send|transfer|lipa|pay|deposit|weka)\b[^.!?\n]{0,25}?(?:\bksh|\bkes|\bsh\b|\bshillings|\bpesa\b|\bmoney\b|\bdoh\b|\bganji\b|\bbob\b|\d)/;

const LINK =
  /(?:https?:\/\/[^\s]+|\bwww\.[^\s]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|co\.ke|go\.ke|ke|xyz|top|online|site|click|link|live|app|shop|store|ly|gd|me|io|icu|buzz)\b(?:\/[^\s]*)?)/g;
const SHORTENER_OR_CHEAP_TLD =
  /^(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|is\.gd|rb\.gy|ow\.ly|tiny\.cc|shorturl\.at|rebrand\.ly|t\.ly|s\.id)$|\.(?:xyz|top|click|online|site|live|shop|icu|buzz)$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SenderKind = 'none' | 'official-mpesa' | 'official-safaricom' | 'registered' | 'named' | 'personal';

function classifySender(sender: string | undefined): SenderKind {
  const s = (sender ?? '').trim();
  if (s.length === 0) return 'none';
  if (normalizeKenyanMsisdn(s) !== null || /^\+?[\d\s\-()]{7,16}$/.test(s)) return 'personal';
  const compact = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (OFFICIAL_SENDERS.has(compact)) {
    return compact === 'MPESA' ? 'official-mpesa' : 'official-safaricom';
  }
  // Anything else ("Mum", "John Kamau") is a name, which vouches for nothing.
  return SENDER_ID.test(s) ? 'registered' : 'named';
}

/** True if `re` matches somewhere in `text` NOT immediately preceded by a negation. */
function matchesUnnegated(text: string, re: RegExp): boolean {
  const global = re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
  for (const m of text.matchAll(global)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (!NEGATION_BEFORE.test(before)) return true;
  }
  return false;
}

function linkHosts(lower: string): string[] {
  const hosts: string[] = [];
  for (const m of lower.matchAll(LINK)) {
    const host = m[0]
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split(/[/?#]/)[0]
      .replace(/[),.;:!]+$/, '');
    if (host.length > 0) hosts.push(host);
  }
  return hosts;
}

function isOfficialDomain(host: string): boolean {
  return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function hasCallInstruction(lower: string): boolean {
  for (const m of lower.matchAll(CALL_VERB)) {
    const window = lower.slice(m.index ?? 0, (m.index ?? 0) + 50);
    if (extractPhoneNumbers(window).length > 0) return true;
  }
  return false;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Score a single SMS / chat message for mobile-money scam patterns.
 * Pure function; runs fully on-device.
 */
export function classifyMessage(text: string, opts: ClassifyOptions = {}): ClassificationResult {
  const original = text.normalize('NFKC');
  const lower = original
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const sender = classifySender(opts.sender);
  const phones = extractPhoneNumbers(original);
  const fired = new Set<FeatureId>();
  const fire = (id: FeatureId, condition: boolean): void => {
    if (condition) fired.add(id);
  };

  // Sender-dependent features.
  const looksLikeConfirmation = CONFIRMATION_CODE.test(original) || CONFIRMATION_WORDING.test(lower);
  if (looksLikeConfirmation) {
    fire('fake-mpesa-confirmation', sender === 'personal');
    fire(
      'confirmation-from-other-sender',
      sender === 'registered' || sender === 'named' || sender === 'official-safaricom',
    );
    fire('unverified-confirmation', sender === 'none');
  }
  fire('official-sender', sender === 'official-mpesa' || sender === 'official-safaricom');
  fire('registered-sender-id', sender === 'registered');
  fire(
    'brand-impersonation',
    sender === 'personal' && !fired.has('fake-mpesa-confirmation') && BRAND_MENTION.test(lower),
  );

  // Content features.
  const hosts = linkHosts(lower);
  // "Enter your PIN" is only a red flag when it is not the phone's own payment
  // prompt / menu, or when there is a link (PIN entry on a web page).
  const enterPin =
    matchesUnnegated(lower, ENTER_PIN) && (hosts.length > 0 || !ON_PHONE_PAYMENT.test(lower));
  fire(
    'pin-request',
    matchesUnnegated(lower, SEND_SECRET) || matchesUnnegated(lower, SECRET_FORWARD) || enterPin,
  );
  fire('personal-info-request', matchesUnnegated(lower, PERSONAL_INFO));
  // A "do not share" disclaimer only reassures when nothing in the message asks
  // for a secret; scammers paste the genuine boilerplate under their PIN ask.
  fire(
    'security-warning',
    !fired.has('pin-request') && !fired.has('personal-info-request') && SECURITY_WARNING.test(lower),
  );
  fire('mistaken-transfer', MISTAKEN_TRANSFER.test(lower));
  fire('reversal-request', REVERSAL_REQUEST.test(lower));
  fire('prize-claim', PRIZE_CLAIM.test(lower));
  fire('promo-language', PROMO_LANGUAGE.test(lower));
  fire('upfront-fee', UPFRONT_FEE.some((re) => re.test(lower)));
  fire('loan-or-job-bait', LOAN_OR_JOB.test(lower));
  fire('suspension-threat', SUSPENSION_THREAT.some((re) => re.test(lower)));
  fire('urgency', URGENCY.test(lower));
  fire('call-instruction', hasCallInstruction(lower));
  fire('loan-plus-call', LOAN_OFFERED.test(lower) && fired.has('call-instruction'));
  fire(
    'fake-customer-care',
    sender !== 'official-mpesa' &&
      sender !== 'official-safaricom' &&
      sender !== 'registered' &&
      CUSTOMER_CARE.test(lower) &&
      phones.some((p) => !KNOWN_CARE_NUMBERS.has(p)),
  );
  fire('new-number-or-distress', NEW_NUMBER_OR_DISTRESS.test(lower));
  fire('secrecy', SECRECY.test(lower));
  fire('money-request', MONEY_REQUEST.test(lower));

  fire('link', hosts.length > 0);
  fire('shortened-or-suspicious-link', hosts.some((h) => SHORTENER_OR_CHEAP_TLD.test(h)));
  fire('lookalike-domain', hosts.some((h) => BRAND_IN_DOMAIN.test(h) && !isOfficialDomain(h)));

  const signals: ScamSignal[] = [...fired]
    .map((id) => ({ id, description: FEATURES[id].description, weight: FEATURES[id].weight }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  const z = signals.reduce((acc, s) => acc + s.weight, BIAS);
  const score = sigmoid(z);
  const label: ScamLabel =
    score >= SCAM_THRESHOLD ? 'scam' : score >= SUSPICIOUS_THRESHOLD ? 'suspicious' : 'likely-safe';

  return { score, label, signals };
}
