// Resolve explicit calendar deadlines in Manila independently of model timezone arithmetic.
// Unsupported/ambiguous phrases remain the model's responsibility.
export function explicitManilaDeadline(text, context={}) {
  if ((context.timezone||'Asia/Manila')!=='Asia/Manila') return null;
  const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const match=text.match(/\b(?:due|deadline(?:\s+is)?|submit\s+by)\s+(?:on\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?(?:\s+(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if(!match)return null;
  const month=months.indexOf(match[1].toLowerCase())+1,day=Number(match[2]);
  const now=new Date(context.currentDate||Date.now());
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(now).map(p=>[p.type,p.value]));
  let year=match[3]?Number(match[3]):Number(parts.year);
  let hour=23,minute=59;
  if(match[4]){hour=Number(match[4]);minute=Number(match[5]||0);if(match[6]){if(hour<1||hour>12)return null;hour=hour%12+(match[6].toLowerCase()==='pm'?12:0);}}
  if(hour>23||minute>59||day<1)return null;
  if(!match[3]&&(month<Number(parts.month)||(month===Number(parts.month)&&day<Number(parts.day))))year++;
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCMonth()!==month-1||check.getUTCDate()!==day)return null;
  return new Date(Date.UTC(year,month-1,day,hour-8,minute)).toISOString();
}
