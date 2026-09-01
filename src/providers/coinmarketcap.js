import https from "https";

const DEFAULT_BASE =
  process.env.CMC_BASE_URL ||
  "https://pro-api.coinmarketcap.com";

function requestJson(url, body, { apiKey, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);

    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    };

    if (apiKey) {
      headers["X-CMC_PRO_API_KEY"] = apiKey;
    }

    const req = https.request(
      url,
      {
        method: "POST",
        headers,
        timeout: timeoutMs,
      },
      res => {
        let data = "";

        res.on("data", chunk => {
          data += chunk;
        });

        res.on("end", () => {
          let parsed = null;

          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            const error = new Error(
              `CoinMarketCap returned invalid JSON (${res.statusCode})`
            );
            error.status = res.statusCode;
            error.provider = "coinmarketcap";
            return reject(error);
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(
              parsed?.status?.error_message ||
              `CoinMarketCap HTTP ${res.statusCode}`
            );

            error.status = res.statusCode;
            error.provider = "coinmarketcap";
            error.body = parsed;

            return reject(error);
          }

          resolve(parsed);
        });
      }
    );

    req.on("timeout", () => {
      const error = new Error(
        "CoinMarketCap request timed out."
      );

      error.provider = "coinmarketcap";
      req.destroy(error);
    });

    req.on("error", reject);

    req.write(payload);
    req.end();
  });
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTags(value) {
  if (!value) return {};

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizeHolder(raw) {
  return {
    wallet: raw.walletAddress || null,

    percent: num(raw.percent) ?? 0,
    balance: num(raw.balance),
    totalSupply: num(raw.totalSupply),

    buyCount: num(raw.buyCount) ?? 0,
    sellCount: num(raw.sellCount) ?? 0,

    buyVolume: num(raw.buyVolume) ?? 0,
    sellVolume: num(raw.sellVolume) ?? 0,

    buyUsd: num(raw.buyUsd) ?? 0,
    sellUsd: num(raw.sellUsd) ?? 0,

    realizedPnl: num(raw.realizedPnl) ?? 0,
    realizedPnlPercent: num(raw.realizedPnlPercent),

    avgBuyPriceUsd: num(raw.avgBuyPriceUsd),
    avgSellPriceUsd: num(raw.avgSellPriceUsd),

    fundingSource: raw.fundingSource || null,
    fundingTime: raw.fundingTime || null,

    firstActiveTime: raw.firstActiveTime || null,
    lastActiveTime: raw.lastActiveTime || null,

    publicName: raw.publicName || null,

    tags: parseTags(raw.tags),

    nativeBalance: num(raw.nativeBalance),

    addressExplorerUrl: raw.addressExplorerUrl || null,
  };
}

function isExcluded(holder) {
  return (
    Number(holder.tags?.tag_lp_contract || 0) > 0 ||
    Number(holder.tags?.tag_smart_contract || 0) > 0
  );
}

export class CoinMarketCapProvider {
  constructor({
    apiKey = process.env.CMC_API_KEY || null,
    baseUrl = DEFAULT_BASE,
    timeoutMs = Number(process.env.CMC_TIMEOUT_MS || 30000),
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async holders(platform, tokenAddress) {
    return requestJson(
      `${this.baseUrl}/public-api/v1/dex/holders/list`,
      {
        tokenAddress,
        platform,
        tag: "tag_all",
      },
      {
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
      }
    );
  }

  async inspectActorBehavior(platform, tokenAddress, tokenFacts = {}) {
    const response = await this.holders(platform, tokenAddress);
    const raw = Array.isArray(response?.data?.holders) ? response.data.holders : [];
    const holders = raw.map(normalizeHolder).filter(h => h.wallet && !isExcluded(h));
    const deployer = String(tokenFacts?.deployer || "").toLowerCase();
    const deployerExitHolder = deployer
      ? holders.find(h => h.wallet.toLowerCase() === deployer && h.sellCount > 0)
      : null;
    const deployerFunded = deployer
      ? holders.filter(h => String(h.fundingSource || "").toLowerCase() === deployer)
      : [];
    const deployerFundedSellers = deployerFunded.filter(h => h.sellCount > 0 && (h.sellVolume >= h.buyVolume * 0.75 || h.sellCount >= 2));
    const materialExit = h => h.sellCount > 0 && (h.sellCount >= 2 || (h.buyVolume > 0 && h.sellVolume / h.buyVolume >= 0.75));

    const withActivity = holders.filter(h => h.firstActiveTime);
    const times = withActivity.map(h => new Date(h.firstActiveTime).getTime()).filter(Number.isFinite).sort((a,b)=>a-b);
    const earlyCutoff = times.length >= 3 ? times[Math.min(times.length-1, Math.max(0, Math.floor(times.length * 0.25)))] : null;
    const early = earlyCutoff == null ? [] : holders.filter(h => Number.isFinite(new Date(h.firstActiveTime).getTime()) && new Date(h.firstActiveTime).getTime() <= earlyCutoff);
    const earlySellers = early.filter(h => h.sellCount > 0 && (h.sellVolume >= h.buyVolume * 0.75 || h.sellCount >= 2) && h.percent >= 3);
    const earlyShare = earlySellers.reduce((sum,h)=>sum+h.percent/100,0);

    const sharedSellerGroups = new Map();
    for(const h of holders.filter(h=>h.sellCount>0 && h.fundingSource)){
      const key=String(h.fundingSource).toLowerCase();
      if(!sharedSellerGroups.has(key)) sharedSellerGroups.set(key,[]);
      sharedSellerGroups.get(key).push(h.wallet);
    }
    const sharedFundingSellerGroups=[...sharedSellerGroups.entries()].filter(([,ws])=>ws.length>=2).map(([funder,wallets])=>({funder,wallets,walletCount:wallets.length}));
    const enrichedSharedGroups=sharedFundingSellerGroups.map(group=>{
      const members=holders.filter(h=>group.wallets.includes(h.wallet));
      const materialMembers=members.filter(materialExit);
      const soldVolume=materialMembers.reduce((sum,h)=>sum+Number(h.sellVolume||0),0);
      const buyVolume=materialMembers.reduce((sum,h)=>sum+Number(h.buyVolume||0),0);
      const soldFraction=buyVolume>0?soldVolume/buyVolume:null;
      const fundingBeforeBuy=members.filter(h=>h.fundingTime&&h.firstActiveTime&&new Date(h.fundingTime).getTime()<=new Date(h.firstActiveTime).getTime()).length;
      return {...group,materialSellerCount:materialMembers.length,soldFraction,fundingBeforeBuy,materialSellerShare:materialMembers.reduce((sum,h)=>sum+h.percent/100,0)};
    });

    const coordinationClue = sharedFundingSellerGroups.some(group => group.wallets.length >= 2);
    const largestSharedSellerGroup = [...sharedFundingSellerGroups].sort((a,b) => b.wallets.length-a.wallets.length)[0] || null;
    const coordinationSignal = Boolean(
      sharedFundingSellerGroups.some(group => group.wallets.length >= 3) &&
      earlySellers.length >= 2
    );

    const cautions=[];
    if(deployerFunded.length){
      cautions.push(`The deployer is listed as the funding source for ${deployerFunded.length} holder wallet(s). Transfers can represent airdrops, allocations, or wallet distribution and are not proof of a rug by themselves.`);
    }
    if(earlySellers.length && !sharedFundingSellerGroups.length){
      cautions.push(`${earlySellers.length} early holder(s) are selling substantial positions; this can be normal profit-taking or a coordinated exit, so timing and wallet relationships require further scrutiny.`);
    }

    return {tool:"inspect_actor_behavior",facts:{
      supported:true,
      deployer,
      deployerExit:Boolean(deployerExitHolder),
      deployerExitWallet:deployerExitHolder?.wallet||null,
      deployerExitDetails:deployerExitHolder ? `The deployer wallet is listed as a holder and has ${deployerExitHolder.sellCount} recorded sell(s).` : null,
      deployerFundedWallets:deployerFunded.map(h=>({wallet:h.wallet,percent:h.percent,sellCount:h.sellCount,sellVolume:h.sellVolume,buyVolume:h.buyVolume})),
      deployerLinkedExit:deployerFundedSellers.length>0,
      deployerLinkedExitDetails:deployerFundedSellers.length ? `${deployerFundedSellers.length} wallet(s) funded by the deployer also show material selling activity.` : null,
      deployerFundedCount:deployerFunded.length,
      deployerFundedSellerCount:deployerFundedSellers.length,
      deployerFundedSellerShare:deployerFundedSellers.reduce((sum,h)=>sum+h.percent/100,0),
      topHolderExit:Boolean(holders.slice().sort((a,b)=>b.percent-a.percent).slice(0,5).some(materialExit)),
      topHolderClusterExit:holders.slice().sort((a,b)=>b.percent-a.percent).slice(0,5).filter(materialExit).length>=2,
      topHolderSellerCount:holders.slice().sort((a,b)=>b.percent-a.percent).slice(0,5).filter(materialExit).length,
      earlyHolderCount:early.length,
      earlySellerCount:earlySellers.length,
      earlyHolderDump:earlySellers.length>=2 && earlyShare>=0.06 && sharedFundingSellerGroups.some(group=>group.wallets.some(w=>earlySellers.some(h=>h.wallet===w))),
      earlyHolderDumpDetails:earlySellers.length>=2 ? `${earlySellers.length} early holder(s) sold substantial positions representing about ${Math.round(earlyShare*100)}% of supply among the qualifying sellers. A stronger coordinated-exit signal is only asserted when a wallet relationship also supports it.` : null,
      sharedFundingSellerGroups:enrichedSharedGroups,
      sharedFundingGroupCount:enrichedSharedGroups.length,
      sharedFundingDump:Boolean(enrichedSharedGroups.some(g=>g.materialSellerCount>=3 && (g.soldFraction==null || g.soldFraction>=0.70))),
      coordinationClue,
      coordinationSignal,
      largestSharedSellerGroup,
      cautions,
      supplyManipulation:false,
      privilegedControlRisk:false,
      note:"This analysis separates observed transfers, selling behaviour, and timing. It does not infer malicious intent from a deployer transfer or early sale alone."
    }};
  }

  async inspectHolders(platform, tokenAddress) {
    const response = await this.holders(platform, tokenAddress);

    const raw = Array.isArray(response?.data?.holders)
      ? response.data.holders
      : [];

    const holders = raw
      .map(normalizeHolder)
      .filter(holder => holder.wallet);

    const excluded = holders.filter(isExcluded);
    const effective = holders.filter(holder => !isExcluded(holder));

    const sorted = [...effective].sort(
      (a, b) => b.percent - a.percent
    );

    const concentration = count =>
      sorted
        .slice(0, count)
        .reduce((sum, holder) => sum + holder.percent, 0);

    const funding = new Map();

    for (const holder of effective) {
      if (!holder.fundingSource) continue;

      if (!funding.has(holder.fundingSource)) {
        funding.set(holder.fundingSource, []);
      }

      funding.get(holder.fundingSource).push(holder.wallet);
    }

    const sharedFundingSources = [...funding.entries()]
      .filter(([, wallets]) => wallets.length > 1)
      .map(([funder, wallets]) => ({
        funder,
        wallets,
        walletCount: wallets.length,
      }));

    const sellers = effective
      .filter(holder => holder.sellCount > 0)
      .sort((a, b) => b.sellVolume - a.sellVolume);

    const materialSellers = sellers.filter(holder => {
      const buy = Number(holder.buyVolume || 0);
      const sell = Number(holder.sellVolume || 0);
      return sell > 0 && (holder.sellCount >= 2 || (buy > 0 && sell / buy >= 0.75));
    });

    const sellerShare = sellers.reduce((sum, holder) => sum + holder.percent / 100, 0);
    const materialSellerShare = materialSellers.reduce((sum, holder) => sum + holder.percent / 100, 0);
    const topHolders = sorted.slice(0, 5);
    const topHolderSellers = topHolders.filter(holder => {
      const buy = Number(holder.buyVolume || 0);
      const sell = Number(holder.sellVolume || 0);
      return sell > 0 && (holder.sellCount >= 2 || (buy > 0 && sell / buy >= 0.75));
    });
    const topHolderExit = Boolean(topHolderSellers.length);
    const topHolderClusterExit = topHolderSellers.length >= 2;

    const tagSummary = {};

    for (const holder of holders) {
      for (const [tag, value] of Object.entries(holder.tags)) {
        if (Number(value) > 0) {
          tagSummary[tag] =
            (tagSummary[tag] || 0) + Number(value);
        }
      }
    }

return {
  tool: "inspect_holders",
  facts: {
    provider: "coinmarketcap",
    supported: true,

    rawHolderCount: holders.length,
    effectiveHolderCount: effective.length,
    excludedCount: excluded.length,

    excludedAddresses: excluded.map(holder => ({
      wallet: holder.wallet,
      percent: holder.percent,
      publicName: holder.publicName,
      tags: holder.tags,
    })),

    // CMC gives percentages.
    // The autopsy engine uses ratios.
    topHolderShare: concentration(1) / 100,
    top3Share: concentration(3) / 100,
    top5Share: concentration(5) / 100,
    sellerCount: sellers.length,
    materialSellerCount: materialSellers.length,
    sellerShare,
    materialSellerShare,
    topHolderExit,
    topHolderClusterExit,
    topHolderSellerCount: topHolderSellers.length,
    topHolderSellerShare: topHolderSellers.reduce((sum, holder) => sum + holder.percent / 100, 0),

    // Holder data in the shape expected by the agent.
    wallets: sorted.map(holder => ({
      wallet: holder.wallet,
      share: holder.percent / 100,
      balance: holder.balance,
      balanceRaw: holder.balance,
      buyCount: holder.buyCount,
      sellCount: holder.sellCount,
      buyVolume: holder.buyVolume,
      sellVolume: holder.sellVolume,
      buyUsd: holder.buyUsd,
      sellUsd: holder.sellUsd,
      realizedPnl: holder.realizedPnl,
      realizedPnlPercent: holder.realizedPnlPercent,
      fundingSource: holder.fundingSource,
      fundingTime: holder.fundingTime,
      tags: holder.tags,
      publicName: holder.publicName,
    })),

    concentratedWalletCount: sorted.filter(
      holder => holder.percent >= 3
    ).length,

    concentratedShare: sorted
      .filter(holder => holder.percent >= 3)
      .reduce(
        (sum, holder) => sum + holder.percent / 100,
        0
      ),

    holders: sorted,
    sellers,

    sellerCount: sellers.length,
    largestSeller: sellers[0] || null,

    sharedFundingSources,
    tagSummary,
  },
};
}
}
 
export function createCoinMarketCapTools(
  input,
  provider = new CoinMarketCapProvider()
) {
  const { ca, chain } = input;

  const platformMap = {
    "solana-mainnet": "solana",
  };

  const platform = platformMap[chain];

  return {
    inspectHolders: () => {
      if (!platform) {
        return {
          tool: "inspect_holders",
          facts: {
            provider: "coinmarketcap",
            supported: false,
            reason:
              "CoinMarketCap holder analysis is currently enabled for Solana only.",
          },
        };
      }

      return provider.inspectHolders(platform, ca);
    },
    inspectActorBehavior: (state) => {
      if (!platform) return {tool:"inspect_actor_behavior",facts:{supported:false,reason:"CoinMarketCap actor analysis is currently enabled for Solana only."}};
      return provider.inspectActorBehavior(platform, ca, state.observations.token || {});
    },
  };
}
