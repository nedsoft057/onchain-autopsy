const EVM=/^0x[a-fA-F0-9]{40}$/;
const SOLANA=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function normalizeInput(raw, chainOverride){
  const ca=String(raw||'').trim();
  if(!ca) throw new Error('Missing token contract address.');

  if(EVM.test(ca)){
    const chain=chainOverride||process.env.GOLDRUSH_CHAIN||'eth-mainnet';
    return {ca,chain,family:'evm'};
  }

  if(SOLANA.test(ca)){
    const chain=chainOverride||'solana-mainnet';
    if(chain!=='solana-mainnet') throw new Error('This address looks like a Solana mint address. Use solana-mainnet.');
    return {ca,chain,family:'solana'};
  }

  throw new Error('Invalid token contract address. Expected an EVM 0x address or a Solana mint address.');
}

export function isFixtureKey(value){
  return ['AICORE','CLEANCORE','LIQUIDTEST'].includes(String(value||'').toUpperCase());
}
