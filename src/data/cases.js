export const cases={
AICORE:{
token:{symbol:"$AICORE",name:"AI Core",ca:"AICORE",deployer:"0xDEPLOYER_AICORE",totalSupply:1000000000},
liquidity:{pair:"AICORE / ETH",initialEth:40,initialToken:1000000000,removedEth:38.4,removedAt:"2026-08-20T15:42:00Z"},
holders:[
{wallet:"0xWALLET_A",share:.12,fundedBy:"0xFUNDER_1"},{wallet:"0xWALLET_B",share:.09,fundedBy:"0xFUNDER_1"},
{wallet:"0xWALLET_C",share:.07,fundedBy:"0xFUNDER_1"},{wallet:"0xWALLET_D",share:.06,fundedBy:"0xFUNDER_1"},
{wallet:"0xWALLET_E",share:.04,fundedBy:"0xFUNDER_1"},{wallet:"0xWALLET_F",share:.03,fundedBy:"0xFUNDER_1"}],
sells:[
{wallet:"0xWALLET_A",sequence:1,soldShare:.12},{wallet:"0xWALLET_B",sequence:2,soldShare:.09},
{wallet:"0xWALLET_C",sequence:3,soldShare:.07},{wallet:"0xWALLET_D",sequence:4,soldShare:.06}]
},
CLEANCORE:{
token:{symbol:"$CLEAN",name:"Clean Core",ca:"CLEANCORE",deployer:"0xDEPLOYER_CLEAN",totalSupply:1000000000},
liquidity:{pair:"CLEAN / ETH",initialEth:25,initialToken:250000000,removedEth:0,removedAt:null},
holders:[
{wallet:"0xCLEAN_A",share:.035,fundedBy:"0xFUNDER_A"},{wallet:"0xCLEAN_B",share:.028,fundedBy:"0xFUNDER_B"},
{wallet:"0xCLEAN_C",share:.022,fundedBy:"0xFUNDER_C"}],
sells:[{wallet:"0xCLEAN_A",sequence:1,soldShare:.01}]
},
LIQUIDTEST:{
token:{symbol:"$LIQ",name:"Liquidity Test",ca:"LIQUIDTEST",deployer:"0xDEPLOYER_LIQ",totalSupply:1000000000},
liquidity:{pair:"LIQ / ETH",initialEth:50,initialToken:500000000,removedEth:47,removedAt:"2026-08-20T14:20:00Z"},
holders:[
{wallet:"0xLIQ_A",share:.08,fundedBy:"0xFUND_X"},{wallet:"0xLIQ_B",share:.06,fundedBy:"0xFUND_Y"}],
sells:[{wallet:"0xLIQ_A",sequence:1,soldShare:.08}]
}
};
