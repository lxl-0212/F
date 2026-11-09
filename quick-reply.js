const TIME_ZONE='Asia/Taipei';
function dateQuestion(q){return /星期幾|禮拜幾|週幾|今天幾號|今日幾號|今天日期|今日日期|今天星期|今日星期/.test(q)}
function timeQuestion(q){return /現在幾點|當地時間|當地幾點/.test(q)}
function localDate(zone=TIME_ZONE){return new Intl.DateTimeFormat('zh-TW',{timeZone:zone,year:'numeric',month:'long',day:'numeric',weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date())}
export async function getQuickReply(query){
  if(dateQuestion(query)) return `今天是${localDate(TIME_ZONE)}。`;
  if(timeQuestion(query)) return `現在台灣時間是${localDate(TIME_ZONE)}。`;
  return null;
}
