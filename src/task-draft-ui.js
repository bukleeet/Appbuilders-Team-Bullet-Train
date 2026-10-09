// Backend estimates can be deliberately null, with the suggestion in warnings.
export function reviewEstimate(draft) {
  const warning=(draft.warnings||[]).find(w=>/^Model estimated \d+ minutes \(unconfirmed\)$/.test(w));
  const suggested=warning?Number(warning.match(/\d+/)[0]):null;
  const uncertain=!!warning||(draft.warnings||[]).some(w=>/unconfirmed|guess/i.test(w));
  return {
    confirmed:uncertain?null:draft.estimatedMinutes,
    suggested:suggested??(uncertain?draft.estimatedMinutes:null)
  };
}
