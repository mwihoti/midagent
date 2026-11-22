/**
 * ScamShield on-device classifier + phone helpers.
 *
 * The corpus below is SYNTHETIC: written to mirror the shapes of real Kenyan
 * mobile-money scams (English, Swahili, Sheng) and of the legitimate messages
 * most likely to be confused with them. Names, numbers and transaction codes
 * are made up. The classifier uses general patterns, not these strings.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyMessage,
  extractPhoneNumbers,
  normalizeKenyanMsisdn,
  targetBytes,
  TARGET_BYTES_LENGTH,
  FEATURES,
  type ClassificationResult,
} from '../../demo/src/scamShield/index';

interface Sample {
  text: string;
  sender?: string;
}

const SCAMS: Sample[] = [
  // Fake M-Pesa confirmation from a personal number.
  {
    text: 'QJK4H7XY2M Confirmed. You have received Ksh3,500.00 from JOHN KAMAU 0712345678 on 12/3/24 at 10:15 AM. New M-PESA balance is Ksh3,620.00.',
    sender: '0798123456',
  },
  // Fake reversal (Swahili).
  {
    text: 'Habari, nimekosea kutuma pesa Ksh 2,000 kwa namba yako. Tafadhali nirudishie haraka, ni pesa ya hospitali.',
    sender: '+254 711 482 903',
  },
  // Fake reversal (English, no sender info).
  { text: 'Hello, I sent you Ksh 1,500 by mistake. Kindly reverse it to 0722 555 111. God bless.' },
  // Fake reversal (Sheng).
  { text: 'Sasa msee, nimeteleza nikakutumia doh mbao tano kimakosa. Ebu ni-reverse haraka tafadhali.' },
  // SIM-block threat + PIN request.
  {
    text: 'Safaricom: Ndugu mteja, line yako itafungwa leo kwa sababu ya usajili. Tuma PIN yako ya M-PESA kwa 0733 222 444 ili kuthibitisha.',
  },
  // Prize + registration fee (Swahili).
  {
    text: 'HONGERA! Umeshinda Ksh 50,000 kwenye Safaricom promotion. Tuma Ksh 300 ada ya usajili kwa 0745 111 222 kupokea zawadi yako.',
  },
  // Prize + delivery fee (English).
  {
    text: 'You have won a Samsung phone in the Safaricom 25th Anniversary draw! Pay a delivery fee of Ksh 450 to claim. Call 0790 333 444 now.',
  },
  // Suspension threat + shortened link.
  { text: 'Your M-PESA account will be suspended within 24 hours. Verify your details at http://bit.ly/mpesa-verify' },
  // Loan + processing fee (Swahili).
  {
    text: 'Mkopo wa Ksh 30,000 umeidhinishwa! Lipa ada ya usindikaji Ksh 500 kwanza kupitia till 556677 upokee pesa leo.',
  },
  // Job + registration fee.
  {
    text: 'JOB OFFER: Supermarket attendants needed, salary 35k. Send registration fee of Ksh 1,000 to 0700 123 456 to secure your slot immediately.',
  },
  // PIN + ID request.
  {
    text: 'Dear customer, we are upgrading M-PESA systems. Please reply with your PIN and ID number to avoid disconnection.',
  },
  // OTP hijack posing as customer care (from a personal number).
  {
    text: 'Mambo! Ni customer care wa Safaricom. Tumekutumia code kwa SMS, nitumie hiyo code tukusaidie kurekebisha line yako.',
    sender: '0757888999',
  },
  // Fake Fuliza limit increase + cheap-TLD link.
  {
    text: 'Fuliza limit yako imeongezwa hadi Ksh 15,000. Bonyeza https://fuliza-boost.xyz kuamilisha kabla ya saa sita usiku.',
  },
  // Fake KRA refund + look-alike domain + PIN entry.
  {
    text: 'KRA: You have a pending tax refund of Ksh 12,400. Click www.kra-refunds.online and enter your M-PESA PIN to receive it.',
  },
  // Fake bank customer care.
  {
    text: 'Hi, this is Equity Bank. Your account has been blocked. Call our customer care on 0768 999 000 to unblock.',
    sender: '0768999000',
  },
  // Fake government cash transfer + fee.
  {
    text: 'Umechaguliwa kupokea msaada wa serikali wa Ksh 10,000 (Inua Jamii). Tuma Ksh 250 ya usajili kwa namba 0711 000 999 ili upate pesa yako.',
  },
  // Fake M-PESA "sent in error" with threat, from a personal number.
  {
    text: 'M-PESA: Dear customer, a transaction of Ksh 4,000 was sent to your number in error. Kindly return it to avoid your line being blocked.',
    sender: '0722 111 333',
  },
  // WhatsApp verification-code hijack.
  {
    text: 'Your WhatsApp will be deactivated. Forward the 6-digit code we sent you to this number to keep your account.',
  },
  // Friend-in-distress / new number (Sheng).
  {
    text: 'Bro niko stuck CBD, nitumie 2k haraka kwa hii namba mpya 0799 456 123, simu yangu imeibiwa. Usimwambie mtu.',
  },
  // Fake promo winner + call agent.
  {
    text: 'Hongera! Your number has been selected as a lucky winner of Ksh 100,000 in the M-PESA Mega Promo. Contact our agent 0701 234 567 for processing.',
  },
  // Instant loan + shortener + activation fee.
  {
    text: 'Get instant loan up to Ksh 50,000 without CRB check! Download app: tinyurl.com/haraka-loan. Activation fee Ksh 200 only.',
  },
  // Fake M-Pesa agent, threat + PIN + deadline (Swahili).
  {
    text: 'Habari, mimi ni wakala wa M-PESA. Akaunti yako ina shida, itasimamishwa usipothibitisha. Nipe nambari ya siri ndani ya dakika 10.',
  },
  // Swahili fake confirmation from a personal number.
  {
    text: 'RCX81KQ2PL Imethibitishwa. Umepokea Ksh7,000.00 kutoka MARY NJERI 0723456789. Salio jipya la M-PESA ni Ksh7,150.00',
    sender: '0110 456 789',
  },
];

const LEGIT: Sample[] = [
  // Genuine M-Pesa confirmations from the MPESA sender.
  {
    text: 'QJK4H7XY2M Confirmed. Ksh500.00 sent to JANE WANJIKU 0712345678 on 14/3/24 at 2:03 PM. New M-PESA balance is Ksh1,240.00. Transaction cost, Ksh7.00.',
    sender: 'MPESA',
  },
  {
    text: 'RBA2K9LMNO Confirmed. You have received Ksh2,000.00 from PETER OTIENO 0722000111 on 2/4/24 at 9:12 AM New M-PESA balance is Ksh2,450.00. Dial *334# to save.',
    sender: 'MPESA',
  },
  // Bank OTP and security warnings.
  {
    text: 'Your one-time password is 482913. Do not share this code with anyone. Equity Bank will never ask for your PIN.',
    sender: 'EQUITYBANK',
  },
  {
    text: 'Dear Customer, never share your M-PESA or bank PIN with anyone, including people claiming to be KCB staff. Call 0711 087 000 for help.',
    sender: 'KCB',
  },
  {
    text: 'Tafadhali usitume PIN yako kwa mtu yeyote. Safaricom haitawahi kukuuliza PIN yako. Ripoti matapeli kwa 333.',
    sender: 'Safaricom',
  },
  // Normal chat (Swahili / Sheng / English).
  { text: 'Habari yako mama? Tutaonana kesho kanisani saa nne.' },
  { text: 'Niaje bro, nitumie ile 500 ya lunch nikulipe Friday.', sender: '0712 998 877' },
  {
    text: "Hey, can you send me Ksh 1,000 for the electricity token? I'll pay you back when I get paid on Friday.",
    sender: '+254701112233',
  },
  { text: 'Nimekutumia 2k ya rent. Confirm ukipata.', sender: '0723 000 456' },
  { text: 'Mum please call me when you get this, nimefika Mombasa salama.' },
  { text: 'Meeting moved to 3pm. Please call 0722 456 789 if you get lost finding the office.' },
  { text: 'Sorry boss, nimechelewa kidogo, niko kwa jam Thika Road. Nitafika in 20 minutes.' },
  { text: 'Ulipata ile pesa nilikutumia jana? Nilituma kwa namba yako ya Safaricom.', sender: '0790 555 222' },
  { text: 'Hongera kwa kushinda mechi jana! Timu yetu iko juu.' },
  { text: 'Babe, nimeweka 1500 kwa M-PESA yako, nunua unga na sukuma ukirudi.', sender: '0745 678 901' },
  { text: 'Niko njiani, nitakupigia nikifika. Usijali.' },
  { text: 'Here are the photos from the wedding: https://photos.google.com/share/AF1QipN' },
  // Legitimate payment requests / reminders.
  {
    text: 'Chama meeting ni Jumamosi. Kila mtu alete mchango wa Ksh 1,000. Lipa kwa paybill 522522 account CHAMA01.',
    sender: '0733 123 987',
  },
  {
    text: 'Reminder: Your SHA contribution of Ksh 500 is due by 9th. Pay via Paybill 200222. Ignore if already paid.',
    sender: 'SHA',
  },
  // Legitimate service messages.
  {
    text: 'Safaricom: Your data bundle of 1GB expires today at midnight. Dial *544# to buy more.',
    sender: 'Safaricom',
  },
  {
    text: 'M-Shwari: Your loan of Ksh 2,000 is due on 15/04/2024. Repay via M-PESA to maintain your limit.',
    sender: 'MPESA',
  },
  {
    text: "Your school fees payment of KES 25,000 for Grace Achieng has been received. Thank you. - St. Mary's Academy",
    sender: 'STMARYS',
  },
  // Genuine on-phone M-PESA payment instructions (STK push, Lipa na M-PESA),
  // where entering your PIN on your own phone is normal.
  { text: 'To pay, go to M-PESA, select Lipa na M-PESA, Buy Goods, enter Till 556677, amount and your M-PESA PIN.' },
  {
    text: 'NAIVAS: Pay Ksh 1,250 for order 5521. An M-PESA prompt has been sent to your phone, enter your M-PESA PIN to complete.',
    sender: 'NAIVAS',
  },
  // Community medical / harambee contribution appeals.
  {
    text: 'Emergency: our member Jane is admitted at KNH. Please send your contribution of Ksh 500 to M-Changa paybill 891300. For queries call 0712 345 678.',
  },
  {
    text: 'Harambee: Mzee Otieno amelazwa Kenyatta. Tafadhali changia kupitia paybill 891300, akaunti JANE. Mungu awabariki.',
  },
  {
    text: 'Hi Kevin, the job interview is confirmed for Monday 10am at our Westlands office. Bring your original certificates and ID.',
    sender: '0720 111 222',
  },
];

/**
 * FROZEN HELD-OUT SET. Written once, after the rules above were tuned, and
 * NEVER used for tuning: do not edit the classifier to make these pass, and do
 * not edit these to match the classifier. Results are LOGGED, not asserted, so
 * misses stay visible instead of being tuned away. Add new samples only as a
 * fresh batch, and report that batch's numbers before changing any rule.
 */
const HELD_OUT_SCAMS: Sample[] = [
  {
    text: 'Habari, mimi ni afisa wa Safaricom. Laini yako ina tatizo la usajili, nitumie namba ya kitambulisho na jina lako kamili tuirekebishe.',
    sender: '0722 908 117',
  },
  { text: 'Congrats! Your HELB disbursement of Ksh 18,000 is ready. To release it, pay a small handling charge of Ksh 350 to 0741 552 009.' },
  { text: 'Mzee, ni mimi Kamau, nimebadilisha line. Nisaidie na 5k niko hospitali, nitakurudishia kesho.', sender: '0703 441 290' },
  { text: 'Your Fuliza account is in arrears and will be reported to CRB today. Clear it now through agent 0769 300 412.' },
  { text: 'Dear subscriber you are among 10 customers to receive Safaricom loyalty points worth Ksh 8,000. Redeem at safaricom-points.top before 6pm.' },
  { text: 'Sorry nimekutumia 1,200 badala ya kutuma kwa mama yangu. Naomba uirudishe kwa hii 0719 230 556.' },
  { text: 'Hi, I am calling from M-PESA fraud department. Someone tried to access your account. To secure it, dial the code we will send you and read it to me.' },
  { text: 'Ksh 45,000 loan approved instantly, no guarantor. Send your M-PESA statement and ID copy to 0757 210 334 on WhatsApp.' },
];

/** Frozen held-out legitimate messages (same rules as HELD_OUT_SCAMS). */
const HELD_OUT_LEGIT: Sample[] = [
  { text: 'Your KPLC token for meter 37190012345 is 1234-5678-9012-3456-7890, 25.4 units. Ksh 600.00 paid.', sender: 'KPLC' },
  { text: 'Hi mum, nimefika shule salama. Nitakupigia jioni.' },
  { text: 'Equity: Ksh 3,000 has been deposited to your account ending 4521. Available balance Ksh 12,450.', sender: 'EQUITYBANK' },
  { text: 'Kesho hakuna maji kutoka saa mbili hadi saa kumi. Tafadhali hifadhi maji. - Nairobi Water', sender: 'NCWSC' },
  { text: 'Bro nimekutumia 2k ya ile deni, asante sana.', sender: '0712 004 991' },
  { text: 'Your appointment at Kenyatta National Hospital is on 12/06 at 9:00am. Arrive 30 minutes early with your NHIF card.', sender: 'KNH' },
];

function run(samples: Sample[]): ClassificationResult[] {
  return samples.map((s) => classifyMessage(s.text, s.sender ? { sender: s.sender } : undefined));
}

function describeFailure(s: Sample, r: ClassificationResult): string {
  return `${r.label} (${r.score.toFixed(3)}) [${r.signals.map((x) => x.id).join(', ')}] <- ${s.text}`;
}

describe('ScamShield classifier: synthetic labelled corpus', () => {
  const scamResults = run(SCAMS);
  const legitResults = run(LEGIT);

  it('has at least 20 scam and 20 legitimate samples', () => {
    expect(SCAMS.length).toBeGreaterThanOrEqual(20);
    expect(LEGIT.length).toBeGreaterThanOrEqual(20);
  });

  it('never labels a scam as likely-safe', () => {
    const misses = SCAMS.flatMap((s, i) =>
      scamResults[i].label === 'likely-safe' ? [describeFailure(s, scamResults[i])] : [],
    );
    expect(misses).toEqual([]);
  });

  it('never labels a legitimate message as scam', () => {
    const falseAlarms = LEGIT.flatMap((s, i) =>
      legitResults[i].label === 'scam' ? [describeFailure(s, legitResults[i])] : [],
    );
    expect(falseAlarms).toEqual([]);
  });

  it('reports precision / recall / accuracy (flagged = scam or suspicious)', () => {
    const tp = scamResults.filter((r) => r.label !== 'likely-safe').length;
    const fn = scamResults.length - tp;
    const fp = legitResults.filter((r) => r.label !== 'likely-safe').length;
    const tn = legitResults.length - fp;
    const precision = tp / (tp + fp);
    const recall = tp / (tp + fn);
    const accuracy = (tp + tn) / (scamResults.length + legitResults.length);
    const scamHard = scamResults.filter((r) => r.label === 'scam').length;
    console.log(
      `[scamShield corpus] scams=${scamResults.length} legit=${legitResults.length} ` +
        `TP=${tp} FN=${fn} FP=${fp} TN=${tn} precision=${precision.toFixed(3)} ` +
        `recall=${recall.toFixed(3)} accuracy=${accuracy.toFixed(3)} ` +
        `scams labelled 'scam'=${scamHard}/${scamResults.length}`,
    );
    expect(recall).toBe(1);
    expect(precision).toBeGreaterThanOrEqual(0.9);
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
    // Most scams should be confidently flagged, not just "suspicious".
    expect(scamHard / scamResults.length).toBeGreaterThanOrEqual(0.75);
  });

  it('scores are probabilities and labels are consistent with signals', () => {
    for (const r of [...scamResults, ...legitResults]) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      for (const s of r.signals) {
        expect(s.description.length).toBeGreaterThan(10);
        expect(FEATURES[s.id as keyof typeof FEATURES].weight).toBe(s.weight);
      }
    }
    // Every flagged scam has at least one positive signal explaining it.
    for (const r of scamResults) {
      expect(r.signals.some((s) => s.weight > 0)).toBe(true);
    }
  });
});

describe('ScamShield classifier: frozen held-out set (logged, not tuned)', () => {
  it('reports held-out recall / false alarms without asserting them', () => {
    const scams = run(HELD_OUT_SCAMS);
    const legit = run(HELD_OUT_LEGIT);
    const caught = scams.filter((r) => r.label !== 'likely-safe').length;
    const falseAlarms = legit.filter((r) => r.label !== 'likely-safe').length;
    console.log(
      `[scamShield held-out] scams flagged=${caught}/${scams.length} ` +
        `legit flagged=${falseAlarms}/${legit.length}\n` +
        [...HELD_OUT_SCAMS.map((s, i) => `  scam  ${describeFailure(s, scams[i])}`),
         ...HELD_OUT_LEGIT.map((s, i) => `  legit ${describeFailure(s, legit[i])}`)].join('\n'),
    );
    // Shape only: these numbers are reported, never tuned against.
    expect(scams.length + legit.length).toBeGreaterThan(0);
  });
});

describe('ScamShield classifier: explanations', () => {
  const ids = (r: ClassificationResult) => r.signals.map((s) => s.id);

  it('empty / plain chat fires no signals and is likely-safe', () => {
    const r = classifyMessage('');
    expect(r.signals).toEqual([]);
    expect(r.label).toBe('likely-safe');
    expect(classifyMessage('Tuonane kesho saa tatu asubuhi').signals).toEqual([]);
  });

  it('the same confirmation text is fake from a personal number and fine from MPESA', () => {
    const text =
      'SAB3C4D5E6 Confirmed. You have received Ksh1,200.00 from ALICE M 0711223344 on 1/5/24. New M-PESA balance is Ksh1,900.00.';
    const fake = classifyMessage(text, { sender: '0700 111 222' });
    const real = classifyMessage(text, { sender: 'MPESA' });
    const unknown = classifyMessage(text);
    expect(fake.label).toBe('scam');
    expect(ids(fake)).toContain('fake-mpesa-confirmation');
    expect(real.label).toBe('likely-safe');
    expect(ids(real)).toContain('official-sender');
    expect(ids(real)).not.toContain('fake-mpesa-confirmation');
    expect(ids(unknown)).toContain('unverified-confirmation');
    expect(fake.score).toBeGreaterThan(unknown.score);
    expect(unknown.score).toBeGreaterThan(real.score);
  });

  it('distinguishes "send your PIN" from "do not share your PIN"', () => {
    const ask = classifyMessage('Please share your PIN with our agent to complete the upgrade.');
    const warn = classifyMessage('Please do not share your PIN with anyone.');
    const askSw = classifyMessage('Tuma PIN yako sasa hivi tukusaidie.');
    const warnSw = classifyMessage('Usitume PIN yako kwa mtu yeyote.');
    expect(ids(ask)).toContain('pin-request');
    expect(ids(askSw)).toContain('pin-request');
    expect(ids(warn)).not.toContain('pin-request');
    expect(ids(warn)).toContain('security-warning');
    expect(ids(warnSw)).not.toContain('pin-request');
    expect(warn.label).toBe('likely-safe');
    expect(warnSw.label).toBe('likely-safe');
    expect(ask.label).not.toBe('likely-safe');
    expect(askSw.label).not.toBe('likely-safe');
  });

  it('explains the fake-reversal scam with both halves of the script', () => {
    const r = classifyMessage('Nimekosea kutuma 3,000 kwa line yako, tafadhali rudisha haraka.');
    expect(ids(r)).toEqual(expect.arrayContaining(['mistaken-transfer', 'reversal-request', 'urgency']));
    expect(r.label).toBe('scam');
  });

  it('flags advance-fee, links, look-alike domains and customer-care numbers', () => {
    const r = classifyMessage(
      'Safaricom customer care: your bonus is ready. Pay a clearance fee at safaricom-bonus.site or call 0711 999 888.',
    );
    expect(ids(r)).toEqual(
      expect.arrayContaining([
        'upfront-fee',
        'link',
        'lookalike-domain',
        'shortened-or-suspicious-link',
        'fake-customer-care',
        'call-instruction',
        'promo-language',
      ]),
    );
    expect(r.label).toBe('scam');
    // Official domain is not a look-alike.
    expect(ids(classifyMessage('Details at https://www.safaricom.co.ke/personal'))).not.toContain(
      'lookalike-domain',
    );
  });

  it('signals are ordered by absolute weight, strongest first', () => {
    const r = classifyMessage(
      'You have won Ksh 20,000! Send your PIN and a registration fee immediately via bit.ly/x1',
    );
    const weights = r.signals.map((s) => Math.abs(s.weight));
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(r.signals[0].id).toBe('pin-request');
  });

  // NOT evidence of generalisation: these use vocabulary the rules were
  // written for. See the frozen held-out set for that.
  it('handles paraphrases of tuned scripts', () => {
    const unseen: Array<[string, string | undefined]> = [
      ['Congratulations, you have won KES 75,000 in our customer reward draw. Send KES 500 to activate your winnings.', undefined],
      ['Pesa ilikuja kwako kimakosa, naomba unirudishie, ni ya karo ya mtoto.', '0712000111'],
      ['Your SIM card will be blocked today. Provide your ID number and date of birth to continue.', undefined],
    ];
    for (const [text, sender] of unseen) {
      const r = classifyMessage(text, sender ? { sender } : undefined);
      expect(r.label, describeFailure({ text }, r)).not.toBe('likely-safe');
    }
  });
});

describe('ScamShield classifier: regressions from review', () => {
  const ids = (r: ClassificationResult) => r.signals.map((s) => s.id);

  it('a pasted "do not share" disclaimer does not cancel an explicit PIN request', () => {
    for (const text of [
      'Dear customer, reply with your M-PESA PIN to verify your line. Safaricom will never ask for your PIN by call.',
      'M-PESA: Tuma PIN yako kwa 0733 222 444 kuthibitisha akaunti. Do not share this message with anyone.',
    ]) {
      const r = classifyMessage(text);
      expect(r.label, describeFailure({ text }, r)).not.toBe('likely-safe');
      expect(ids(r)).toContain('pin-request');
      expect(ids(r)).not.toContain('security-warning');
    }
    // A genuine OTP still gets the reassurance.
    const otp = classifyMessage('Your verification code is 123456. Do not share this code with anyone.');
    expect(ids(otp)).toContain('security-warning');
    expect(otp.label).toBe('likely-safe');
  });

  it('"enter your M-PESA PIN" on the phone\'s own prompt is not a PIN request; on a linked page it is', () => {
    const stk = classifyMessage(
      'NAIVAS: Pay Ksh 1,250 for order 5521. An M-PESA prompt has been sent to your phone, enter your M-PESA PIN to complete.',
    );
    expect(ids(stk)).not.toContain('pin-request');
    expect(stk.label).toBe('likely-safe');
    const phish = classifyMessage('Pay via Lipa na M-PESA at www.mpesa-pay.online and enter your M-PESA PIN there.');
    expect(ids(phish)).toContain('pin-request');
  });

  it('a bare "emergency" in a community appeal is not first-person distress', () => {
    const appeal = classifyMessage(
      'Emergency: our member Jane is admitted at KNH. Please send your contribution of Ksh 500 to M-Changa paybill 891300. For queries call 0712 345 678.',
    );
    expect(ids(appeal)).not.toContain('new-number-or-distress');
    expect(ids(classifyMessage('Nina dharura, nitumie 2k haraka.'))).toContain('new-number-or-distress');
    expect(ids(classifyMessage("I'm in an emergency, send me 3k now."))).toContain('new-number-or-distress');
  });

  /**
   * Fresh wordings a reviewer found the baseline missed. The rules were then
   * extended FOR these messages, so passing here is a regression check, not a
   * measure of accuracy on unseen text (that is the frozen held-out set).
   */
  it('reviewer-found misses are now flagged (regression set, tuned on)', () => {
    const fixed: Array<[string, string | undefined]> = [
      ['Umepata mkopo wa Ksh 25,000. Ili kupokea pesa yako piga simu 0798 112 233.', undefined],
      ['I sent you Ksh 2,000 by accident. Please send it back.', undefined],
      ['I accidentally sent my 6 digit code to your phone. Could you please forward it to me? It is urgent.', undefined],
      ['Safaricom customer care: we noticed an error on your M-PESA. Call 0745 220 118 to fix it.', undefined],
      ['nimekutumia 3k wrong, nirudishie', undefined],
      ['Hello, this is Safaricom SIM registration. To keep your line active, send your ID number and date of birth to this number.', '0798 553 110'],
    ];
    for (const [text, sender] of fixed) {
      const r = classifyMessage(text, sender ? { sender } : undefined);
      expect(r.label, describeFailure({ text }, r)).not.toBe('likely-safe');
    }
    // Still missed (known gap, kept visible): a payment-redirect with no other
    // red flag. "utume" now counts as a send verb, but that alone is weak.
    const redirect = classifyMessage('Ile pesa ya rent utume kwa hii number 0712 640 118, ile ingine ina shida.');
    expect(ids(redirect)).toContain('money-request');
    expect(redirect.label).toBe('likely-safe');
  });
});

describe('ScamShield phone helpers', () => {
  it('normalises Kenyan mobile numbers in common formats', () => {
    const cases: Array<[string, string]> = [
      ['0712345678', '254712345678'],
      ['0112345678', '254112345678'],
      ['712345678', '254712345678'],
      ['112345678', '254112345678'],
      ['+254712345678', '254712345678'],
      ['254712345678', '254712345678'],
      ['+254 712 345 678', '254712345678'],
      ['0712-345-678', '254712345678'],
      ['(0712) 345 678', '254712345678'],
      ['  +254-110-345-678 ', '254110345678'],
      ['0120 345 678', '254120345678'],
      ['0140 345 678', '254140345678'],
      ['0182 345 678', '254182345678'],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeKenyanMsisdn(input), input).toBe(expected);
    }
  });

  it('rejects anything that is not a Kenyan mobile number', () => {
    const bad = [
      '',
      '   ',
      '0812345678', // not a 07/01 mobile prefix
      '020 1234567', // Nairobi landline
      '071234567', // too short
      '07123456789', // too long
      '+0712345678', // '+' without country code
      '2540712345678', // country code + trunk 0
      '+255712345678', // Tanzania
      '254 7123 4567 8x',
      '0712345678 ext 1',
      '07123+45678',
      '100', // short code
      'MPESA',
      '0123456789', // 0123: not assigned
      '0199999999', // 0199: reserved for network testing
    ];
    for (const input of bad) {
      expect(normalizeKenyanMsisdn(input), input).toBeNull();
    }
  });

  it('extracts, normalises and de-duplicates numbers from free text', () => {
    const text =
      'Call 0712 345 678 or +254712345678, WhatsApp (0110) 222-333, ref QJK4H7XY2M, amount Ksh1,500.00, till 556677, id 12345678901.';
    expect(extractPhoneNumbers(text)).toEqual(['254712345678', '254110222333']);
    expect(extractPhoneNumbers('no numbers here, just *334# and 2024')).toEqual([]);
  });

  it('does not turn amounts, account or invoice numbers into phone numbers', () => {
    for (const text of [
      'Ksh 1 500 000.00 imetumwa',
      'Ref account 712345678 for your loan',
      'Paid Ksh 100 000 000 total',
      'Invoice 1 2 3 4 5 6 7 8 9 attached',
      'Ksh 1.234.567.89',
      'Till 123456789',
    ]) {
      expect(extractPhoneNumbers(text), text).toEqual([]);
    }
    // Typed into a single-number field, the bare 9-digit form still works.
    expect(normalizeKenyanMsisdn('712345678')).toBe('254712345678');
  });

  it('encodes targetBytes as 32-byte zero-padded "msisdn:<normalised>"', () => {
    const b = targetBytes('0712 345 678');
    expect(b).toBeInstanceOf(Uint8Array);
    expect(b.length).toBe(32);
    expect(TARGET_BYTES_LENGTH).toBe(32);
    const prefix = new TextDecoder().decode(b.slice(0, 19));
    expect(prefix).toBe('msisdn:254712345678');
    expect([...b.slice(19)].every((x) => x === 0)).toBe(true);
    // Every input form of the same number yields identical bytes.
    expect(targetBytes('+254712345678')).toEqual(b);
    expect(targetBytes('712345678')).toEqual(b);
    expect(() => targetBytes('12345')).toThrow();
    expect(() => targetBytes('not a number')).toThrow();
  });
});
