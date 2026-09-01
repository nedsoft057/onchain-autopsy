import {providerCapabilities} from "./capabilities.js";

export class EvidenceProvider {
  constructor(provider){ this.provider=provider; }

  capabilities(chain){
    return providerCapabilities(chain);
  }

  async inspectToken(chain, ca){
    return this.provider.inspectToken(chain, ca);
  }

  async inspectHolders(chain, ca){
    const caps=this.capabilities(chain);
    if(!caps.token_holders){
      return {
        tool:"inspect_holders",
        status:"unavailable",
        reason:"unsupported_by_provider",
        facts:{chain,ca}
      };
    }
    try{
      return {...await this.provider.holders(chain,ca),tool:"inspect_holders",status:"available"};
    }catch(error){
      return {
        tool:"inspect_holders",
        status:"unavailable",
        reason:"provider_error",
        providerStatus:error.status||null,
        message:error.message,
        facts:{chain,ca}
      };
    }
  }
}
