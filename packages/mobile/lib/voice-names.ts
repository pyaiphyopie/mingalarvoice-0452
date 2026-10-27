// Mirrors packages/web/src/web/lib/voice-names.ts — keep both in sync. Display aliases only; they do not assert nationality.
const names: Record<string, string> = {
  CwhRBWXzGAHq8TQ4Fs17: "ကိုအောင်",
  EXAVITQu4vr4xnSDxMaL: "မသီတာ",
  FGY2WhTYpPnrIDTdsKH5: "မနှင်း",
  IKne3meq5aSn9XLyUdCD: "ကိုရဲ",
  JBFqnCBsd6RMkjVDRZzb: "ကိုမင်း",
  N2lVS1w4EtoT3dr4eOWO: "ကိုကျော်",
  SAz9YHcvj6GT2YYXdXww: "ငြိမ်းချမ်း",
  SOYHLrjzK2X1ezoPC6cr: "ကိုဇော်",
  TX3LPaxmHKxFdv7VOQHJ: "ကိုလင်း",
  Xb7hH8MSUJpSbSDYk0k2: "မခင်",
  XrExE9yKIg1WjnnlVkGX: "မမြတ်",
  bIHbv24MWmeRgasZH58o: "ကိုသက်",
  cgSgspJ2msm6clMCkdW9: "မပန်း",
  cjVigY5qzO86Huf0OWal: "ကိုထွန်း",
  hpp4J3VqNfWAUOO0d1Us: "မဝေ",
  iP95p4xoKVk53GoZ742B: "ကိုစိုး",
  nPczCjzI2devNBz1zQrb: "ကိုနိုင်",
  onwK4e9ZLuTAKqWW03F9: "ကိုဟိန်း",
  pFZP5JQG7iQjIQuC4Bku: "မလှ",
  pNInz6obpgDQGcFmaJgB: "ကိုမောင်",
  pqHfZKP75CvOlQylNhV4: "ဦးတင်",
  BZgkqPqms7Kj9ulSkVzn: "မရွှေ",
  exsUS4vynmxd379XN4yO: "မချို",
  RILOU7YmBhvwJGDGjNmP: "ဒေါ်နု",
  QF9HJC7XWnue5c9W3LkY: "ကိုသီဟ",
  "9IzcwKmvwJcw58h3KnlH": "ကိုအာကာ",
  nzFihrBIvB34imQBuxub: "ကိုနေ",
  dtSEyYGNJqjrtBArPCVZ: "ကိုဗလ",
  "8kgj5469z1URcH4MB2G4": "မမေ",
  eXpIbVcVbLo8ZJQDlDnl: "မယု",
  "0ptCJp0xgdabdcpVtCB5": "မနွယ်",
  Rsz5u2Huh1hPlPr0oxRQ: "ကိုငြိမ်း",
};
export function voiceName(id: string): string {
  if (names[id]) return names[id];
  // Stable Burmese-only fallback for newly available provider voices.
  const n = [...id].reduce((total, c) => total + c.charCodeAt(0), 0);
  return "အသံ " + String(n).replace(/[0-9]/g, (d) => "၀၁၂၃၄၅၆၇၈၉"[Number(d)]);
}
