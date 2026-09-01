/*
  Clean scene mapping.

  No crosses are baked into the scene image.

  Primary anchors correspond to meaningful objects already present in the
  3D crime scene. Coordinates are placeholders for the future 3D world;
  the frontend will replace them with actual object/anchor transforms.
*/

const PRIMARY_ANCHORS=[
{anchorId:"computer_deployment",label:"computer",x:.18,y:.35},
{anchorId:"spoon_cluster",label:"spoon",x:.38,y:.52},
{anchorId:"knife_selling",label:"knife",x:.57,y:.48},
{anchorId:"cupboard_funding",label:"cupboard",x:.72,y:.34},
{anchorId:"fridge_liquidity",label:"fridge",x:.84,y:.55},
{anchorId:"balcony_exit",label:"balcony",x:.94,y:.30},
{anchorId:"broken_glass",label:"broken_glass",x:.28,y:.78},
{anchorId:"table_activity",label:"table",x:.50,y:.72}
];

const FALLBACK_ANCHORS=[
{x:.12,y:.62},{x:.24,y:.28},{x:.44,y:.34},{x:.65,y:.68},
{x:.79,y:.77},{x:.90,y:.72},{x:.34,y:.88},{x:.68,y:.18},
{x:.08,y:.40},{x:.31,y:.16},{x:.53,y:.24},{x:.76,y:.16},
{x:.88,y:.42},{x:.57,y:.86},{x:.18,y:.84},{x:.43,y:.58}
];

const TYPE_TO_ANCHOR={
token_deployment:"computer_deployment",
wallet_cluster:"spoon_cluster",
wallet_relationship:"cupboard_funding",
sell_sequence:"knife_selling",
deployer_exit:"computer_deployment",
deployer_distribution:"cupboard_funding",
early_holder_dump:"knife_selling",
actor_caution:"table_activity",
coordination_signal:"cupboard_funding",
liquidity_exit:"fridge_liquidity",
top_holder_exit:"knife_selling",
top_holder_cluster_exit:"knife_selling",
holder_distribution:"spoon_cluster",
wallet_concentration:"spoon_cluster",
seller_activity:"table_activity",
shared_funding_source:"cupboard_funding",
shared_funding_sellers:"cupboard_funding",
shared_funding_dump:"knife_selling",
funding_before_buy:"cupboard_funding",
deployer_funding_map:"computer_deployment",
sell_activity_sequence:"knife_selling",
coordinated_selling:"knife_selling"
};

export function mapEvidenceToScene(evidence){
  const used=new Set();
  const primary=new Map(PRIMARY_ANCHORS.map(a=>[a.anchorId,a]));
  const markers=[];

  for(const item of evidence){
    const desired=TYPE_TO_ANCHOR[item.type];
    let anchor=desired?primary.get(desired):null;

    if(anchor&&!used.has(anchor.anchorId)){
      used.add(anchor.anchorId);
      markers.push({...item,scene:{mode:"primary",anchorId:anchor.anchorId,object:anchor.label,x:anchor.x,y:anchor.y}});
      continue;
    }

    const fallback=FALLBACK_ANCHORS.find((_,i)=>!used.has(`fallback_${i}`));
    if(fallback){
      const i=FALLBACK_ANCHORS.indexOf(fallback);
      used.add(`fallback_${i}`);
      markers.push({...item,scene:{mode:"fallback",anchorId:`fallback_${i}`,x:fallback.x,y:fallback.y}});
    }
  }

  return markers;
}
