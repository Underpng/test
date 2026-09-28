// shortTitle drops the release tags scan files carry, for places where the
// title should read cleanly:
//   "Shaman King v16 {KC Complete Edtion} (2018) (Digital SD) (KG Manga)"
//   -> "Shaman King v16"
// Groups in [], (), {}, 【】 and （） are removed (not 「」『』, which are often
// part of a Japanese title); if nothing would be left, the title is
// returned unchanged.
const TAG = /\s*[[({【（][^\])}】）]*[\])}】）]/g;

export function shortTitle(title: string): string {
    const short = title.replace(TAG, "").replace(/\s+/g, " ").trim();
    return short || title;
}
