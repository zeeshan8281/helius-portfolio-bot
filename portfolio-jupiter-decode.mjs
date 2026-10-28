import { OWNER } from './policy.mjs';

const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const EVENT_AUTHORITY = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf';
// On-chain Jupiter IDL C88XWfp26heEmDkmfSzeXP7Fd7GQJ2j9dDTUsyiZbUTa, finalized slot462262056.
const ROUTE_V2 = Buffer.from('bb64facc31c4af14', 'hex');
const SHARED_ROUTE_V2 = Buffer.from('d19853937cfed8e9', 'hex');
// Exact Swap enum and its dependencies from the same on-chain IDL; new enum tags fail closed.
const ROUTE_TYPES = {
  "BisonFiPredictSide": {"kind":"enum","variants":[{"name":"Yes"},{"name":"No"}]},
  "CandidateSwap": {"kind":"enum","variants":[{"name":"HumidiFi","fields":[{"name":"swap_id","type":"u64"},{"name":"is_base_to_quote","type":"bool"}]},{"name":"TesseraV","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},{"name":"HumidiFiV2","fields":[{"name":"swap_id","type":"u64"},{"name":"is_base_to_quote","type":"bool"}]},{"name":"RaydiumV2"},{"name":"RaydiumClmm"},{"name":"Whirlpool","fields":[{"name":"a_to_b","type":"bool"}]},{"name":"ZeroFi"},{"name":"BisonFiV2","fields":[{"name":"a_to_b","type":"bool"}]},{"name":"GoonFiV2","fields":[{"name":"is_bid","type":"bool"}]},{"name":"GoonFiV3","fields":[{"name":"is_bid","type":"bool"}]},{"name":"WhirlpoolV2","fields":[{"name":"a_to_b","type":"bool"},{"name":"remaining_accounts_info","type":{"option":{"defined":{"name":"RemainingAccountsInfo"}}}}]},{"name":"ZeroFiSwapV2"},{"name":"BisonFiMarketBacked","fields":[{"name":"a_to_b","type":"bool"}]},{"name":"RaydiumClmmV2"},{"name":"TesseraVV2","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},{"name":"HumidiFiRouter","fields":[{"name":"claimed_ms","type":"u64"},{"name":"seed_rng","type":{"array":["u8",32]}},{"name":"token","type":{"array":["u8",16]}},{"name":"is_base_to_quote","type":"bool"}]},{"name":"HumidiFiRouterV2","fields":[{"name":"router_id","type":"u64"},{"name":"claimed_ms","type":"u64"},{"name":"seed_rng","type":{"array":["u8",32]}},{"name":"token","type":{"array":["u8",16]}},{"name":"is_base_to_quote","type":"bool"}]},{"name":"HumidiFiRouterV3","fields":[{"name":"router_id","type":"u64"},{"name":"generation","type":"u64"},{"name":"minted","type":"u64"},{"name":"expiry","type":"u64"},{"name":"seed_rng","type":{"array":["u8",32]}},{"name":"token","type":{"array":["u8",16]}},{"name":"is_base_to_quote","type":"bool"}]},{"name":"ZeroFiSwapV3"}]},
  "CandidateSwapWithBps": {"kind":"struct","fields":[{"name":"candidate_swap","type":{"defined":{"name":"CandidateSwap"}}},{"name":"bps","type":"u32"}]},
  "HyloSwapType": {"kind":"enum","variants":[{"name":"MintStable"},{"name":"RedeemStable"},{"name":"MintLever"},{"name":"RedeemLever"},{"name":"SwapStableToLever"},{"name":"SwapLeverToStable"},{"name":"StabilityPoolDeposit"},{"name":"StabilityPoolWithdraw"}]},
  "PerenaTrancheKind": {"kind":"enum","variants":[{"name":"Junior"},{"name":"Senior"}]},
  "RemainingAccountsInfo": {"kind":"struct","fields":[{"name":"slices","type":{"vec":{"defined":{"name":"RemainingAccountsSlice"}}}}]},
  "RemainingAccountsSlice": {"kind":"struct","fields":[{"name":"accounts_type","type":"u8"},{"name":"length","type":"u8"}]},
  "SanctumSolsSwapType": {"kind":"enum","variants":[{"name":"Mint"},{"name":"Claim"},{"name":"ClaimHolding"}]},
  "Side": {"kind":"enum","variants":[{"name":"Bid"},{"name":"Ask"}]},
  "Swap": { "kind": "enum", "variants": [
    {"name":"Saber"},
    {"name":"SaberAddDecimalsDeposit"},
    {"name":"SaberAddDecimalsWithdraw"},
    {"name":"TokenSwap"},
    {"name":"Sencha"},
    {"name":"Step"},
    {"name":"Cropper"},
    {"name":"Raydium"},
    {"name":"Crema","fields":[{"name":"a_to_b","type":"bool"}]},
    {"name":"Lifinity"},
    {"name":"Mercurial"},
    {"name":"Cykura"},
    {"name":"Serum","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"MarinadeDeposit"},
    {"name":"MarinadeUnstake"},
    {"name":"Aldrin","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"AldrinV2","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"Whirlpool","fields":[{"name":"a_to_b","type":"bool"}]},
    {"name":"Invariant","fields":[{"name":"x_to_y","type":"bool"}]},
    {"name":"Meteora"},
    {"name":"GooseFX"},
    {"name":"DeltaFi","fields":[{"name":"stable","type":"bool"}]},
    {"name":"Balansol"},
    {"name":"MarcoPolo","fields":[{"name":"x_to_y","type":"bool"}]},
    {"name":"Dradex","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"LifinityV2"},
    {"name":"RaydiumClmm"},
    {"name":"Openbook","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"Phoenix","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"Symmetry","fields":[{"name":"from_token_id","type":"u64"},{"name":"to_token_id","type":"u64"}]},
    {"name":"TokenSwapV2"},
    {"name":"HeliumTreasuryManagementRedeemV0"},
    {"name":"StakeDexStakeWrappedSol"},
    {"name":"StakeDexSwapViaStake","fields":[{"name":"bridge_stake_seed","type":"u32"}]},
    {"name":"GooseFXV2"},
    {"name":"Perps"},
    {"name":"PerpsAddLiquidity"},
    {"name":"PerpsRemoveLiquidity"},
    {"name":"MeteoraDlmm"},
    {"name":"OpenBookV2","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"RaydiumClmmV2"},
    {"name":"StakeDexPrefundWithdrawStakeAndDepositStake","fields":[{"name":"bridge_stake_seed","type":"u32"}]},
    {"name":"Clone","fields":[{"name":"pool_index","type":"u8"},{"name":"quantity_is_input","type":"bool"},{"name":"quantity_is_collateral","type":"bool"}]},
    {"name":"SanctumS","fields":[{"name":"src_lst_value_calc_accs","type":"u8"},{"name":"dst_lst_value_calc_accs","type":"u8"},{"name":"src_lst_index","type":"u32"},{"name":"dst_lst_index","type":"u32"}]},
    {"name":"SanctumSAddLiquidity","fields":[{"name":"lst_value_calc_accs","type":"u8"},{"name":"lst_index","type":"u32"}]},
    {"name":"SanctumSRemoveLiquidity","fields":[{"name":"lst_value_calc_accs","type":"u8"},{"name":"lst_index","type":"u32"}]},
    {"name":"RaydiumCP"},
    {"name":"WhirlpoolSwapV2","fields":[{"name":"a_to_b","type":"bool"},{"name":"remaining_accounts_info","type":{"option":{"defined":{"name":"RemainingAccountsInfo"}}}}]},
    {"name":"OneIntro"},
    {"name":"PumpWrappedBuy"},
    {"name":"PumpWrappedSell"},
    {"name":"PerpsV2"},
    {"name":"PerpsV2AddLiquidity"},
    {"name":"PerpsV2RemoveLiquidity"},
    {"name":"MoonshotWrappedBuy"},
    {"name":"MoonshotWrappedSell"},
    {"name":"StabbleStableSwap"},
    {"name":"StabbleWeightedSwap"},
    {"name":"Obric","fields":[{"name":"x_to_y","type":"bool"}]},
    {"name":"FoxBuyFromEstimatedCost"},
    {"name":"FoxClaimPartial","fields":[{"name":"is_y","type":"bool"}]},
    {"name":"SolFi","fields":[{"name":"is_quote_to_base","type":"bool"}]},
    {"name":"SolayerDelegateNoInit"},
    {"name":"SolayerUndelegateNoInit"},
    {"name":"TokenMill","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"DaosFunBuy"},
    {"name":"DaosFunSell"},
    {"name":"ZeroFi"},
    {"name":"StakeDexWithdrawWrappedSol"},
    {"name":"VirtualsBuy"},
    {"name":"VirtualsSell"},
    {"name":"Perena","fields":[{"name":"in_index","type":"u8"},{"name":"out_index","type":"u8"}]},
    {"name":"PumpSwapBuy"},
    {"name":"PumpSwapSell"},
    {"name":"Gamma"},
    {"name":"MeteoraDlmmSwapV2","fields":[{"name":"remaining_accounts_info","type":{"defined":{"name":"RemainingAccountsInfo"}}}]},
    {"name":"Woofi"},
    {"name":"MeteoraDammV2"},
    {"name":"MeteoraDynamicBondingCurveSwap"},
    {"name":"StabbleStableSwapV2"},
    {"name":"StabbleWeightedSwapV2"},
    {"name":"RaydiumLaunchlabBuy","fields":[{"name":"share_fee_rate","type":"u64"}]},
    {"name":"RaydiumLaunchlabSell","fields":[{"name":"share_fee_rate","type":"u64"}]},
    {"name":"BoopdotfunWrappedBuy"},
    {"name":"BoopdotfunWrappedSell"},
    {"name":"Plasma","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"GoonFi","fields":[{"name":"is_bid","type":"bool"},{"name":"blacklist_bump","type":"u8"}]},
    {"name":"HumidiFi","fields":[{"name":"swap_id","type":"u64"},{"name":"is_base_to_quote","type":"bool"}]},
    {"name":"MeteoraDynamicBondingCurveSwapWithRemainingAccounts"},
    {"name":"TesseraV","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"PumpWrappedBuyV2"},
    {"name":"PumpWrappedSellV2"},
    {"name":"PumpSwapBuyV2"},
    {"name":"PumpSwapSellV2"},
    {"name":"Heaven","fields":[{"name":"a_to_b","type":"bool"}]},
    {"name":"SolFiV2","fields":[{"name":"is_quote_to_base","type":"bool"}]},
    {"name":"Aquifer"},
    {"name":"PumpWrappedBuyV3"},
    {"name":"PumpWrappedSellV3"},
    {"name":"PumpSwapBuyV3"},
    {"name":"PumpSwapSellV3"},
    {"name":"JupiterLendDeposit"},
    {"name":"JupiterLendRedeem"},
    {"name":"DefiTuna","fields":[{"name":"a_to_b","type":"bool"},{"name":"remaining_accounts_info","type":{"option":{"defined":{"name":"RemainingAccountsInfo"}}}}]},
    {"name":"AlphaQ","fields":[{"name":"a_to_b","type":"bool"}]},
    {"name":"RaydiumV2"},
    {"name":"SarosDlmm","fields":[{"name":"swap_for_y","type":"bool"}]},
    {"name":"Futarchy","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"MeteoraDammV2WithRemainingAccounts"},
    {"name":"Obsidian"},
    {"name":"WhaleStreet","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"DynamicV1","fields":[{"name":"candidate_swaps","type":{"vec":{"defined":{"name":"CandidateSwap"}}}},{"name":"best_position","type":{"option":"u8"}}]},
    {"name":"PumpWrappedBuyV4"},
    {"name":"PumpWrappedSellV4"},
    {"name":"CarrotIssue"},
    {"name":"CarrotRedeem"},
    {"name":"Manifest","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"BisonFi","fields":[{"name":"a_to_b","type":"bool"}]},
    {"name":"HumidiFiV2","fields":[{"name":"swap_id","type":"u64"},{"name":"is_base_to_quote","type":"bool"}]},
    {"name":"PerenaStar","fields":[{"name":"is_mint","type":"bool"}]},
    {"name":"JupiterRfqV2","fields":[{"name":"side","type":{"defined":{"name":"Side"}}},{"name":"fill_data","type":"bytes"}]},
    {"name":"GoonFiV2","fields":[{"name":"is_bid","type":"bool"}]},
    {"name":"Scorch","fields":[{"name":"swap_id","type":"u128"}]},
    {"name":"VaultLiquidUnstake","fields":[{"name":"lst_amounts","type":{"array":["u64",5]}},{"name":"seed","type":"u64"}]},
    {"name":"XOrca"},
    {"name":"Quantum","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"WhaleStreetV2","fields":[{"name":"side","type":{"defined":{"name":"Side"}}},{"name":"auth_amount_in","type":"u64"},{"name":"auth","type":"u64"}]},
    {"name":"Riptide","fields":[{"name":"amount_is_token_a","type":"bool"}]},
    {"name":"RunnerRodeo"},
    {"name":"TaurusFi","fields":[{"name":"is_base_in","type":"bool"}]},
    {"name":"Omnipair"},
    {"name":"MSwap"},
    {"name":"Hylo","fields":[{"name":"swap_type","type":{"defined":{"name":"HyloSwapType"}}}]},
    {"name":"VoltrDeposit"},
    {"name":"VoltrWithdraw"},
    {"name":"SanctumSV2","fields":[{"name":"src_lst_value_calc_accs","type":"u8"},{"name":"dst_lst_value_calc_accs","type":"u8"},{"name":"src_lst_index","type":"u32"},{"name":"dst_lst_index","type":"u32"}]},
    {"name":"LemmingsFi","fields":[{"name":"is_base_in","type":"bool"}]},
    {"name":"ScaleVmmBuy"},
    {"name":"ScaleVmmSell"},
    {"name":"ScaleAmmBuy"},
    {"name":"ScaleAmmSell"},
    {"name":"BisonFiV2","fields":[{"name":"a_to_b","type":"bool"}]},
    {"name":"Trends"},
    {"name":"HumaDeposit"},
    {"name":"HumaInstantWithdraw"},
    {"name":"Kipseli","fields":[{"name":"is_base_to_quote","type":"bool"}]},
    {"name":"DynamicV2","fields":[{"name":"candidate_swaps","type":{"vec":{"defined":{"name":"CandidateSwapWithBps"}}}},{"name":"max_split_quote_calls","type":"u8"},{"name":"max_split_candidates","type":"u8"}]},
    {"name":"PumpSwapBuyV3WithCashbackClaim"},
    {"name":"PumpSwapSellV3WithCashbackClaim"},
    {"name":"PumpWrappedBuyV4WithCashbackClaim"},
    {"name":"PumpWrappedSellV4WithCashbackClaim"},
    {"name":"GoonFiV3","fields":[{"name":"is_bid","type":"bool"}]},
    {"name":"PumpWrappedBuyV5","fields":[{"name":"claim_cashback","type":"bool"}]},
    {"name":"PumpWrappedSellV5","fields":[{"name":"claim_cashback","type":"bool"}]},
    {"name":"ZeroFiSwapV2"},
    {"name":"BisonFiPredict","fields":[{"name":"side","type":{"defined":{"name":"BisonFiPredictSide"}}},{"name":"is_buy","type":"bool"}]},
    {"name":"ByrealDynamicV3"},
    {"name":"Flux","fields":[{"name":"swap_id","type":"u64"},{"name":"base_to_quote","type":"bool"}]},
    {"name":"VaultLiquidSellLst"},
    {"name":"VaultLiquidBuyLst","fields":[{"name":"lst_amount","type":"u64"}]},
    {"name":"KipseliV2","fields":[{"name":"is_base_to_quote","type":"bool"}]},
    {"name":"Deriverse","fields":[{"name":"side","type":{"defined":{"name":"Side"}}},{"name":"instr_id","type":"u32"}]},
    {"name":"Hadron","fields":[{"name":"is_x","type":"bool"}]},
    {"name":"BinaryFi"},
    {"name":"Metric","fields":[{"name":"zero_for_one","type":"bool"}]},
    {"name":"JupiterLendDexSwap","fields":[{"name":"swap0to1","type":"bool"}]},
    {"name":"Gatorswap","fields":[{"name":"base_to_quote","type":"bool"}]},
    {"name":"Flint","fields":[{"name":"is_global","type":"bool"},{"name":"taker_buy","type":"bool"}]},
    {"name":"Denali","fields":[{"name":"base_to_quote","type":"bool"}]},
    {"name":"PerenaStarV2Deposit"},
    {"name":"PerenaStarV2WithdrawFromExternal","fields":[{"name":"external_liquidity_source","type":"u8"}]},
    {"name":"SanctumSols","fields":[{"name":"swap_type","type":{"defined":{"name":"SanctumSolsSwapType"}}}]},
    {"name":"HyloV2","fields":[{"name":"swap_type","type":{"defined":{"name":"HyloSwapType"}}}]},
    {"name":"SanctumPamm"},
    {"name":"Archer","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"TrenchWrappedBuy"},
    {"name":"TrenchWrappedSell"},
    {"name":"BisonFiMarketBacked","fields":[{"name":"a_to_b","type":"bool"}]},
    {"name":"TesseraVV2","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"Stableswap"},
    {"name":"BinaryFiV2"},
    {"name":"KipseliV3","fields":[{"name":"is_base_to_quote","type":"bool"}]},
    {"name":"PerenaStarV2TrancheDeposit","fields":[{"name":"kind","type":{"defined":{"name":"PerenaTrancheKind"}}}]},
    {"name":"PerenaStarV2TrancheWithdrawFromExternal","fields":[{"name":"kind","type":{"defined":{"name":"PerenaTrancheKind"}}},{"name":"external_liquidity_source","type":{"option":"u8"}}]},
    {"name":"Quay","fields":[{"name":"sell_base","type":"bool"}]},
    {"name":"HumidiFiRouter","fields":[{"name":"claimed_ms","type":"u64"},{"name":"seed_rng","type":{"array":["u8",32]}},{"name":"token","type":{"array":["u8",16]}},{"name":"is_base_to_quote","type":"bool"}]},
    {"name":"HumidiFiRouterV2","fields":[{"name":"router_id","type":"u64"},{"name":"claimed_ms","type":"u64"},{"name":"seed_rng","type":{"array":["u8",32]}},{"name":"token","type":{"array":["u8",16]}},{"name":"is_base_to_quote","type":"bool"}]},
    {"name":"PumpWrappedBuyV6","fields":[{"name":"claim_cashback","type":"bool"},{"name":"allow_partial_fill","type":"bool"}]},
    {"name":"HyloRouter"},
    {"name":"Memefun","fields":[{"name":"quote_to_base","type":"bool"}]},
    {"name":"HumidiFiRouterV3","fields":[{"name":"router_id","type":"u64"},{"name":"generation","type":"u64"},{"name":"minted","type":"u64"},{"name":"expiry","type":"u64"},{"name":"seed_rng","type":{"array":["u8",32]}},{"name":"token","type":{"array":["u8",16]}},{"name":"is_base_to_quote","type":"bool"}]},
    {"name":"PumpWrappedBuyV7","fields":[{"name":"allow_partial_fill","type":"bool"},{"name":"close_user_volume_accumulator","type":"bool"}]},
    {"name":"PumpWrappedSellV6","fields":[{"name":"close_user_volume_accumulator","type":"bool"}]},
    {"name":"PumpSwapBuyV4","fields":[{"name":"close_user_volume_accumulator","type":"bool"}]},
    {"name":"PumpSwapSellV4","fields":[{"name":"close_user_volume_accumulator","type":"bool"}]},
    {"name":"ZeroFiSwapV3"},
    {"name":"DenaliV2","fields":[{"name":"base_to_quote","type":"bool"}]},
    {"name":"QuantumV2","fields":[{"name":"side","type":{"defined":{"name":"Side"}}}]},
    {"name":"DrFraudsworthSolBuy"},
    {"name":"DrFraudsworthSolSell","fields":[{"name":"is_zig","type":"bool"}]},
    {"name":"DrFraudsworthSplBuy"},
    {"name":"DrFraudsworthSplSell"},
    {"name":"DrFraudsworthVaultConvert"},
  ] },
};

function wireAmount(value) {
  if (typeof value !== 'string' || value.length > 20 || !/^(0|[1-9]\d*)$/.test(value)) throw Error('Invalid Jupiter quote amount');
  const n = BigInt(value);
  if (n === 0n || n > 0xffffffffffffffffn) throw Error('Jupiter quote amount is outside u64');
  return n;
}

export function checkJupiterSwapInstruction(build, { inputAddress, outputAddress, ownedTokenAddresses, sharedAccounts }) {
  const ix = build.swapInstruction;
  if (ix?.programId !== JUPITER || typeof ix.data !== 'string' || ix.data.length > 5464 || !Array.isArray(ix.accounts) || ix.accounts.length < 10 ||
      typeof inputAddress !== 'string' || typeof outputAddress !== 'string' || inputAddress === outputAddress)
    throw Error('Missing expected Jupiter instruction accounts');
  const data = Buffer.from(ix.data, 'base64');
  const shared = data.subarray(0, 8).equals(SHARED_ROUTE_V2), offset = shared ? 9 : 8;
  if (data.toString('base64') !== ix.data || data.length < 31 + offset || data.length > 4096 ||
      !shared && !data.subarray(0, 8).equals(ROUTE_V2))
    throw Error('Unsupported Jupiter instruction format');
  if (shared && (ix.accounts.length < 12 || data[8] >= 16 || sharedAccounts?.id !== data[8] ||
      !['programAuthority', 'programSourceTokenAccount', 'programDestinationTokenAccount'].every(key => typeof sharedAccounts?.[key] === 'string')))
    throw Error('Shared Jupiter accounts require independent PDA derivation');
  const inAmount = data.readBigUInt64LE(offset), quotedOutAmount = data.readBigUInt64LE(offset + 8);
  const slippageBps = data.readUInt16LE(offset + 16), platformFeeBps = data.readUInt16LE(offset + 18), positiveSlippageBps = data.readUInt16LE(offset + 20);
  if (build.swapMode !== 'ExactIn' || build.transactionVersion !== 0 || build.slippageBps !== 50 || slippageBps !== build.slippageBps ||
      platformFeeBps !== 0 || positiveSlippageBps !== 0 || inAmount !== wireAmount(build.inAmount) || quotedOutAmount !== wireAmount(build.outAmount))
    throw Error('Encoded Jupiter amounts, slippage or fees differ from the checked quote');
  const minimumOutputAtomic = quotedOutAmount * BigInt(10_000 - slippageBps) / 10_000n;
  const quoteMinimumOutputAtomic = (quotedOutAmount * BigInt(10_000 - slippageBps) + 9_999n) / 10_000n;
  if (wireAmount(build.otherAmountThreshold) !== quoteMinimumOutputAtomic)
    throw Error('Jupiter minimum output differs from the encoded quote terms');
  let cursor = offset + 22;
  function take(bytes) {
    if (cursor + bytes > data.length) throw Error('Unsupported Jupiter route plan: truncated data');
    const start = cursor; cursor += bytes; return start;
  }
  function read(type, depth = 0) {
    if (depth > 12) throw Error('Unsupported Jupiter route plan: nesting limit');
    if (type === 'u8') return data[take(1)];
    if (type === 'u16') return data.readUInt16LE(take(2));
    if (type === 'u32') return data.readUInt32LE(take(4));
    if (type === 'u64' || type === 'u128') { take(type === 'u64' ? 8 : 16); return; }
    if (type === 'bool') {
      const value = read('u8');
      if (value > 1) throw Error('Unsupported Jupiter route plan: invalid bool');
      return value === 1;
    }
    if (type === 'bytes') {
      const length = read('u32');
      if (length > 4096) throw Error('Unsupported Jupiter route plan: byte length limit');
      take(length); return;
    }
    if (type?.option) {
      const present = read('u8');
      if (present > 1) throw Error('Unsupported Jupiter route plan: invalid option');
      if (present) return read(type.option, depth + 1);
      return;
    }
    if (type?.vec || type?.array) {
      const element = type.vec ?? type.array[0], length = type.vec ? read('u32') : type.array[1];
      if (!Number.isInteger(length) || length < 0 || length > 64) throw Error('Unsupported Jupiter route plan: vector limit');
      for (let i = 0; i < length; i++) read(element, depth + 1);
      return;
    }
    const defined = ROUTE_TYPES[type?.defined?.name];
    if (!defined || !['struct', 'enum'].includes(defined.kind)) throw Error('Unsupported Jupiter route plan: unknown schema');
    const variant = defined.kind === 'enum' ? defined.variants[read('u8')] : defined;
    if (!variant) throw Error('Unsupported Jupiter route plan: unknown enum');
    for (const field of variant.fields ?? []) {
      const value = read(field.type, depth + 1);
      if (field.name === 'allow_partial_fill' && value === true) throw Error('Unsupported Jupiter route plan: partial fill');
    }
    return variant.name;
  }
  const routeCount = read('u32'), routePlan = [], outgoingBps = new Map(), availableInputs = new Set([0]);
  if (routeCount < 1 || routeCount > 64) throw Error('Unsupported Jupiter route plan: step limit');
  for (let i = 0; i < routeCount; i++) {
    const venue = read({ defined: { name: 'Swap' } }), bps = read('u16'), inputIndex = read('u8'), outputIndex = read('u8');
    if (bps < 1 || bps > 10_000 || inputIndex === outputIndex || outputIndex === 0 || !availableInputs.has(inputIndex))
      throw Error('Unsupported Jupiter route plan: invalid route step');
    outgoingBps.set(inputIndex, (outgoingBps.get(inputIndex) ?? 0) + bps);
    availableInputs.add(outputIndex);
    routePlan.push({ venue, bps, inputIndex, outputIndex });
  }
  if (cursor !== data.length || !outgoingBps.has(0) || [...outgoingBps.values()].some(bps => bps !== 10_000))
    throw Error('Unsupported Jupiter route plan: trailing data or incomplete exact-in allocation');
  if (ownedTokenAddresses !== undefined && !(Array.isArray(ownedTokenAddresses) || ownedTokenAddresses instanceof Set))
    throw Error('Invalid owned token account context');
  const owned = new Set(ownedTokenAddresses ?? []);
  if ([...owned].some(address => typeof address !== 'string')) throw Error('Invalid owned token account context');
  const expected = shared
    ? [sharedAccounts.programAuthority, OWNER, inputAddress, sharedAccounts.programSourceTokenAccount, sharedAccounts.programDestinationTokenAccount,
      outputAddress, build.inputMint, build.outputMint, TOKEN, TOKEN, EVENT_AUTHORITY, JUPITER]
    : [OWNER, inputAddress, outputAddress, build.inputMint, build.outputMint, TOKEN, TOKEN, JUPITER, EVENT_AUTHORITY, JUPITER];
  const signerIndex = shared ? 1 : 0, writableIndexes = shared ? [2, 3, 4, 5] : [1, 2];
  for (let i = 0; i < ix.accounts.length; i++) {
    const account = ix.accounts[i];
    if (!account || typeof account.pubkey !== 'string' || typeof account.isSigner !== 'boolean' || typeof account.isWritable !== 'boolean' ||
        account.isSigner && account.pubkey !== OWNER ||
        account.isWritable && owned.has(account.pubkey) && account.pubkey !== inputAddress && account.pubkey !== outputAddress || i < expected.length && account.pubkey !== expected[i] ||
        i < expected.length && account.isSigner !== (i === signerIndex) || i < expected.length && account.isWritable !== writableIndexes.includes(i))
      throw Error('Jupiter authority, mint, token program or destination account differs from the checked route');
  }
  return { instruction: shared ? 'shared_accounts_route_v2' : 'route_v2', sharedAuthorityId: shared ? data[8] : undefined,
    routePlan, venue: routePlan.length === 1 ? routePlan[0].venue : undefined, inAmount, quotedOutAmount, slippageBps, platformFeeBps, positiveSlippageBps,
    minimumOutputAtomic, quoteMinimumOutputAtomic, inputAddress, outputAddress, unrelatedAccountCheckPerformed: ownedTokenAddresses !== undefined };
}

export async function verifyJupiterSwapInstruction(build, context) {
  let sharedAccounts;
  const encoded = build.swapInstruction?.data;
  if (typeof encoded === 'string' && encoded.length <= 5464 && Buffer.from(encoded, 'base64').subarray(0, 8).equals(SHARED_ROUTE_V2)) {
    const id = Buffer.from(encoded, 'base64')[8];
    if (!Number.isInteger(id) || id >= 16) throw Error('Unsupported Jupiter shared authority ID');
    const { PublicKey } = await import('@solana/web3.js');
    // Official seeds: https://github.com/jup-ag/jupiter-amm-implementation/blob/main/jupiter/src/lib.rs
    const [authority] = await PublicKey.findProgramAddress([Buffer.from('authority'), Buffer.from([id])], new PublicKey(JUPITER));
    const associatedProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const [source, destination] = await Promise.all([build.inputMint, build.outputMint].map(async mint => {
      const [address] = await PublicKey.findProgramAddress([authority.toBytes(), new PublicKey(TOKEN).toBytes(), new PublicKey(mint).toBytes()], associatedProgram);
      return address.toBase58();
    }));
    sharedAccounts = { id, programAuthority: authority.toBase58(), programSourceTokenAccount: source, programDestinationTokenAccount: destination };
  }
  return checkJupiterSwapInstruction(build, { ...context, sharedAccounts });
}
