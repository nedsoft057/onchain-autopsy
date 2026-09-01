export function progress(event, data={}){
  const suffix=Object.entries(data).map(([k,v])=>`${k}=${v}`).join(" ");
  console.log(`${event}${suffix?` → ${suffix}`:""}`);
}
