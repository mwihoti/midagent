import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/ledger-v8';
import {
  type MidnightProvider,
  type UnboundTransaction,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { type WalletFacade, type FacadeState } from '@midnight-ntwrk/wallet-sdk-facade';
import { type UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  readonly wallet: WalletFacade;

  private constructor(
    private readonly logger: Logger,
    wallet: WalletFacade,
    private readonly zswapSecretKeys: ZswapSecretKeys,
    private readonly dustSecretKey: DustSecretKey,
    private readonly keystore: UnshieldedKeystore,
  ) {
    this.wallet = wallet;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(
    tx: UnboundTransaction,
    ttl: Date = ttlOneHour(),
  ): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: this.zswapSecretKeys,
        dustSecretKey: this.dustSecretKey,
      },
      { ttl },
    );
    // Sign the unshielded segment with the keystore before finalizing — without
    // this the balancing (dust fee) transaction is rejected as unauthorized.
    const signed = await this.wallet.signRecipe(recipe, (payload) =>
      this.keystore.signData(payload),
    );
    return await this.wallet.finalizeRecipe(signed);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    seed?: string,
    mnemonic?: string,
  ): Promise<MidnightWalletProvider> {
    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    };

    const builder = FluentWalletBuilder.forEnvironment(env)
      .withDustOptions(dustOptions);

    // buildWithoutStarting() returns { wallet, seeds, keystore }; seeds holds the
    // derived key material we need to construct the secret keys, and keystore signs
    // unshielded segments (fee balancing + dust registration). Unlike build(), it
    // does NOT start the wallet, so we start it explicitly below.
    const { wallet, seeds, keystore } = await (
      mnemonic ? builder.withMnemonic(mnemonic) : builder.withSeed(seed!)
    ).buildWithoutStarting();

    const provider = new MidnightWalletProvider(
      logger,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
    );

    await provider.start();
    logger.info(`Wallet built and started from ${mnemonic ? 'mnemonic' : 'seed'}`);

    return provider;
  }

  /**
   * Registers the wallet's NIGHT UTXOs for DUST generation. On preprod, NIGHT
   * only generates the DUST used to pay transaction fees after the backing UTXOs
   * are explicitly registered via an on-chain (fee-exempt) transaction. Returns
   * how many UTXOs were newly registered and the submitted tx id (if any).
   */
  async registerForDustGeneration(
    state: FacadeState,
  ): Promise<{ registered: number; txId?: string }> {
    const nightUtxos = (state.unshielded as any).totalCoins as any[];
    const unregistered = nightUtxos.filter(
      (u) => !u.meta?.registeredForDustGeneration,
    );
    if (unregistered.length === 0) {
      this.logger.info('All NIGHT UTXOs already registered for dust generation.');
      return { registered: 0 };
    }

    this.logger.info(
      `Registering ${unregistered.length} NIGHT UTXO(s) for dust generation...`,
    );

    // The node-client's submission path connects, loads metadata, disconnects, then
    // reconnects on demand; that reconnect can flap and drop the first submit with a
    // clean WS close (1000). Rebuild + resubmit a few times so a stabilized
    // connection can land the transaction.
    const attempts = 5;
    let lastErr: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        // Per the official pattern, the registration recipe is finalized and
        // submitted directly — it carries its own dust-registration signature
        // (via signDustRegistration) and has no unshielded spend, so it must NOT
        // go through signRecipe (that corrupts it and the node rejects it).
        const recipe = await this.wallet.registerNightUtxosForDustGeneration(
          unregistered,
          this.keystore.getPublicKey(),
          (payload) => this.keystore.signData(payload),
        );
        const finalized = await this.wallet.finalizeRecipe(recipe);
        const txId = await this.wallet.submitTransaction(finalized);
        this.logger.info(`Dust registration submitted: ${txId}`);
        return { registered: unregistered.length, txId };
      } catch (err) {
        lastErr = err;
        const msg = (err as Error)?.message ?? String(err);
        this.logger.warn(`Dust registration attempt ${i}/${attempts} failed: ${msg}`);
        if (i < attempts) {
          await new Promise((r) => setTimeout(r, 5_000));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Stops the shielded (zswap) subsystem's background sync. A dust-fee-only
   * contract deploy never touches shielded coins, but syncing the shielded
   * chain history from genesis is the dominant memory consumer and OOMs the
   * process before the dust subsystem catches up. Stopping it early keeps the
   * process within a normal heap while unshielded + dust continue syncing.
   */
  async stopShielded(): Promise<void> {
    try {
      await (this.wallet as any).shielded?.stop?.();
      this.logger.info('Shielded subsystem stopped (not needed for dust-fee deploy).');
    } catch (err) {
      this.logger.warn(`Could not stop shielded subsystem: ${(err as Error).message}`);
    }
  }

  /**
   * Waits until the wallet holds at least `minSpecks` of spendable DUST. DUST
   * generated from registered NIGHT is only observable once the (separate, slow)
   * dust subsystem has synced up to the point on-chain where it was generated —
   * from a cold start this can take a long time, so the timeout is generous and
   * progress (applied index vs target, plus ETA) is logged as it advances.
   */
  async waitForDust(minSpecks = 1n, timeout = 6 * 60 * 60_000): Promise<bigint> {
    this.logger.info(`Waiting for spendable dust (>= ${minSpecks} Specks)...`);
    const start = Date.now();
    let lastApplied = 0n;
    let lastLog = 0;
    // Subscribe to the dust subsystem's OWN state observable rather than the
    // facade's combined state() — after we stop the shielded subsystem, the
    // combined combineLatest stream can stall, but dust.state keeps emitting.
    const dustState$: Rx.Observable<any> = (this.wallet as any).dust.state;
    return Rx.firstValueFrom(
      dustState$.pipe(
        Rx.map((dust: any) => {
          // Log dust-sync progress + ETA periodically so the long wait is visible.
          const p: any = dust?.state?.progress ?? dust?.progress;
          if (p) {
            const applied = BigInt(p.appliedIndex ?? 0);
            const target = BigInt(p.highestRelevantWalletIndex ?? 0);
            const now = Date.now();
            if (lastLog === 0) {
              lastLog = now;
              lastApplied = applied;
            } else if (now - lastLog > 30_000) {
              const elapsed = (now - start) / 1000;
              const done = Number(applied - lastApplied);
              const rate = done > 0 ? done / ((now - lastLog) / 1000) : 0;
              const remaining = target > applied ? Number(target - applied) : 0;
              const etaMin = rate > 0 ? Math.round(remaining / rate / 60) : -1;
              const pct = target > 0n ? Number((applied * 100n) / target) : 0;
              this.logger.info(
                `Dust sync: applied=${applied}/${target} (${pct}%)` +
                  (etaMin >= 0 ? `, ~${etaMin} min to go` : '') +
                  `, elapsed ${Math.round(elapsed)}s`,
              );
              lastLog = now;
              lastApplied = applied;
            }
          }
          try {
            const coins = dust?.availableCoinsWithFullInfo?.(new Date()) ?? [];
            return coins.reduce(
              (acc: bigint, c: any) => acc + BigInt(c.generatedNow ?? 0),
              0n,
            );
          } catch {
            return 0n;
          }
        }),
        Rx.distinctUntilChanged(),
        Rx.tap((specks: bigint) => {
          if (specks > 0n) this.logger.info(`Spendable dust: ${specks} Specks`);
        }),
        Rx.filter((specks: bigint) => specks >= minSpecks),
        Rx.timeout({
          first: timeout,
          with: () =>
            Rx.throwError(
              () => new Error(`Timed out waiting for dust after ${timeout}ms`),
            ),
        }),
      ),
    );
  }
}

function isProgressStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
}

export async function syncWallet(
  logger: Logger,
  wallet: WalletFacade,
  timeout = 300_000,
  maxEmissions = 150,
): Promise<FacadeState> {
  logger.info('Syncing wallet...');
  let emissionCount = 0;
  const deadline = Date.now() + timeout;

  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissionCount++;
        const shielded = isProgressStrictlyComplete(state.shielded.state.progress);
        const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
        const dust = isProgressStrictlyComplete(state.dust.state.progress);
        logger.info(
          `Wallet sync [${emissionCount}]: shielded=${shielded}, unshielded=${unshielded}, dust=${dust}`,
        );
      }),
      Rx.filter(
        (state: FacadeState) =>
          isProgressStrictlyComplete(state.shielded.state.progress) &&
          isProgressStrictlyComplete(state.dust.state.progress) &&
          isProgressStrictlyComplete(state.unshielded.progress),
      ),
      Rx.tap(() => logger.info(`Wallet sync complete after ${emissionCount} emissions`)),
      Rx.timeout({
        each: Math.max(10_000, Math.floor((deadline - Date.now()) / 2)),
        with: () =>
          Rx.throwError(
            () => new Error(`Wallet sync timeout after ${emissionCount} emissions (${Math.floor((deadline - Date.now()) / 1000)}s remaining)`),
          ),
      }),
      Rx.catchError((err) => {
        logger.error(`Wallet sync error: ${err}`);
        return Rx.throwError(() => err);
      }),
    ),
  );
}

export async function syncWalletUnshielded(
  logger: Logger,
  wallet: WalletFacade,
  timeout = 120_000,
): Promise<FacadeState> {
  logger.info('Syncing wallet (unshielded only)...');
  let emissionCount = 0;
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissionCount++;
        const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
        if (emissionCount % 10 === 0) {
          logger.info(`Wallet sync [${emissionCount}]: unshielded=${unshielded}`);
        }
      }),
      Rx.filter(
        (state: FacadeState) =>
          isProgressStrictlyComplete(state.unshielded.progress),
      ),
      Rx.tap(() => logger.info(`Wallet unshielded sync complete after ${emissionCount} emissions`)),
      Rx.timeout({
        each: timeout,
        with: () =>
          Rx.throwError(
            () => new Error(`Wallet unshielded sync timeout after ${timeout}ms`),
          ),
      }),
      Rx.catchError((err) => {
        logger.error(`Wallet sync error: ${err}`);
        return Rx.throwError(() => err);
      }),
    ),
  );
}
