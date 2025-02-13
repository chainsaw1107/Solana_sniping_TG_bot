import { Filter, FilterResult } from './pool-filters';
import { Connection } from '@solana/web3.js';
import { LiquidityPoolKeysV4 } from '@raydium-io/raydium-sdk';
import { getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import { MetadataAccountData, MetadataAccountDataArgs } from '@metaplex-foundation/mpl-token-metadata';
import { Serializer } from '@metaplex-foundation/umi/serializers';
import { HAS_ANY_SOCIAL, HAS_TELEGRAM, HAS_TWITTER, HAS_WEBSITE, HAS_IMAGE, HAS_DESCRIPTION, logger } from '../helpers';

export class MutableFilter implements Filter {
  private readonly errorMessage: string[] = [];
  private cachedResult: FilterResult | undefined = undefined;

  constructor(
    private readonly connection: Connection,
    private readonly metadataSerializer: Serializer<MetadataAccountDataArgs, MetadataAccountData>,
    private readonly checkMutable: boolean,
    private readonly checkSocials: boolean,
  ) {
    if (this.checkMutable) {
      this.errorMessage.push('mutable');
    }

    if (this.checkSocials) {
      this.errorMessage.push('socials');
    }
  }

  async execute(poolKeys: LiquidityPoolKeysV4): Promise<FilterResult> {
    if (this.cachedResult) {
      return this.cachedResult;
    }

    try {
      const metadataPDA = getPdaMetadataKey(poolKeys.baseMint);
      const metadataAccount = await this.connection.getAccountInfo(metadataPDA.publicKey, this.connection.commitment);

      if (!metadataAccount?.data) {
        return { ok: false, message: 'Mutable -> Failed to fetch account data' };
      }

      const deserialize = this.metadataSerializer.deserialize(metadataAccount.data);
      const mutable = !this.checkMutable || deserialize[0].isMutable;
      const hasSocials = !this.checkSocials || (await this.hasSocials(deserialize[0]));
      const ok = !mutable && hasSocials;
      const message: string[] = [];

      if (mutable) {
        message.push('metadata can be changed');
      }

      if (!hasSocials) {
        message.push('has no socials');
      }

      const result = { ok: ok, message: ok ? undefined : `MutableSocials -> Token ${message.join(' and ')}` };

      if (!mutable) {
        this.cachedResult = result;
      }

      return result;
    } catch (e) {
      logger.error({ mint: poolKeys.baseMint }, `MutableSocials -> Failed to check ${this.errorMessage.join(' and ')}`);
    }

    return {
      ok: false,
      message: `MutableSocials -> Failed to check ${this.errorMessage.join(' and ')}`,
    };
  }

  private async hasSocials(metadata: MetadataAccountData) {
    const response = await fetch(metadata.uri);
    const data = await response.json();
    const {
      image,
      description,
      extensions: { website, twitter, telegram },
    } = data;
    logger.trace({ image, description, website, twitter, telegram });
    if (HAS_ANY_SOCIAL) {
      if (image || description || telegram || twitter || website) return true;
      return Object.values(data?.extensions ?? {}).filter((value: any) => value).length > 0;
    } else {
      let flag = false;
      if (HAS_IMAGE) flag = flag || image;
      if (HAS_DESCRIPTION) flag = flag || description;
      if (HAS_TELEGRAM) flag = flag || telegram;
      if (HAS_TWITTER) flag = flag || twitter;
      if (HAS_WEBSITE) flag = flag || website;
      return flag;
    }
  }
}
