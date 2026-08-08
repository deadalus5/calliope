/**
 * Theory notes in the user's language: one lore card per chord quality,
 * written in degrees ('1, b3, 5, b7') and record references — no
 * conservatory framing. QUALITY_LORE mirrors QUALITIES in chord.ts
 * one-to-one; FLAVOR_GROUPS is the Chord Library picker layout
 * (every quality except the identification-only 'maj7no5' alias).
 */

export interface QualityLore {
  qualityId: string
  /** One sentence: what it sounds like / the feeling. */
  color: string
  /** Degree-stack recipe. */
  build: string
  /** Where it wants to go, or 'happy to sit'. */
  pull: string
  /** 1-3 real-world anchors: genres, moves, records. */
  uses: string[]
  /** 1-3 follow-up moves in degree language, for the 'where next' hint. */
  nextMoves: string[]
}

export const QUALITY_LORE: QualityLore[] = [
  {
    qualityId: 'maj',
    color: 'Bright and settled, nothing to prove — home base with the door open.',
    build: '1 3 5 — the major pentatonic (1 2 3 5 6) with the 2 and 6 left out.',
    pull: 'Happy to sit; everything else in the key points back at it.',
    uses: ['the I in nearly every soul and gospel tune', '"Stand By Me" — plain triads doing all the work'],
    nextMoves: ['add the b7 on top and it turns into the blues 7th', 'drop the 3 to b3 — same grip idea, minor side of the coin'],
  },
  {
    qualityId: 'min',
    color: 'The serious side of the same coin — the minor-pentatonic home feeling as one grip.',
    build: '1 b3 5 — minor pentatonic (1 b3 4 5 b7) with the 4 and b7 left out.',
    pull: 'Happy to sit; on a vamp it barely moves at all.',
    uses: ['minor blues and every vi chord in soul', 'the "Chain of Fools" vamp — one minor chord, whole song'],
    nextMoves: ['add the b7 → m7, the soul workhorse', 'raise b3 to 3 and it flips major'],
  },
  {
    qualityId: 'dim',
    color: 'Pinched and unstable — a minor triad with the 5 squeezed down a fret.',
    build: '1 b3 b5.',
    pull: 'Never sits — it slides a half step into whatever is next.',
    uses: ['gospel walk-ups between two chords', 'the passing chord under a bass line climbing the low E'],
    nextMoves: ['stack another b3 on top → dim7, the full elevator', 'raise b5 back to 5 → plain minor'],
  },
  {
    qualityId: 'aug',
    color: 'The #5 push — a held breath, everything lifted a little too high on purpose.',
    build: '1 3 #5 — major triad with the 5 raised a fret (the board and chips spell that note b6 — same fret, same sound).',
    pull: 'The #5 wants up a half step, into the next chord\'s root or 3.',
    uses: ['the "Oh! Darling" intro chord', 'the lift in "Crying" before the melody lands'],
    nextMoves: ['let the #5 rise a half step and land on the IV', 'drop #5 back to 5 → plain major, tension released'],
  },
  {
    qualityId: 'sus4',
    color: 'Neither major nor minor — the 4 hangs where the 3 should be, wide open and unresolved.',
    build: '1 4 5 — no third at all.',
    pull: 'The 4 wants to fall a half step onto the 3; the release is the whole point.',
    uses: ['the classic sus4 → major amen move in gospel', 'the "Pinball Wizard"-style suspended strum before the release'],
    nextMoves: ['let the 4 fall to 3 → plain major', 'add the b7 → 7sus4, the soul haze version'],
  },
  {
    qualityId: 'sus2',
    color: 'Open and airy — the 2 sits where the 3 would, and no major/minor decision gets made.',
    build: '1 2 5 — no third at all.',
    pull: 'The 2 can rise to the 3, or just ring — plenty of records let it sit.',
    uses: ['ringing intro chords that shimmer instead of declaring a key', 'sliding the same grip around — sus2 shapes stack without clashing'],
    nextMoves: ['raise the 2 to 3 → major', 'push the 2 up two frets to the 4 and keep floating: sus2 → sus4 → 3 is a classic strum figure'],
  },
  {
    qualityId: 'maj7',
    color: 'The b7\'s polished cousin — natural-7 shimmer, candlelight where the blues chord has grit.',
    build: 'Major triad + the natural 7, one fret under the octave.',
    pull: 'Happy to sit — it is the ballad home chord.',
    uses: ['Curtis Mayfield ballads', 'the Isley Brothers\' "For the Love of You" float', 'the I in quiet-storm soul'],
    nextMoves: ['drop the 7 a half step → dom7 and the room turns bluesy', 'stack the 2 on top → maj9, even plusher'],
  },
  {
    qualityId: 'min7',
    color: 'b3 + b7 — the soul workhorse; smoky, relaxed, sits forever on a vamp.',
    build: '1 b3 5 b7 — four of the minor pentatonic\'s five notes in one grip (only the 4 stays home).',
    pull: 'Happy to vamp; in a two-chord move it leans up a 4th into a 7th chord.',
    uses: ['"Use Me"-style one-chord grooves', 'every ii chord in soul and Motown', 'the "Chameleon" vamp'],
    nextMoves: ['up a 4th to a 7th chord — the ii–V move', 'add the 2 → m9 for the slow-jam version'],
  },
  {
    qualityId: 'dom7',
    color: 'Major brightness with a b7 lean — the blues home sound; tense on paper, home in practice.',
    build: 'Major triad + b7: 1 3 5 b7.',
    pull: 'Wants to fall up a 4th — but in a blues all three chords are 7ths and nobody resolves anything.',
    uses: ['the I, IV, and V of every 12-bar blues', 'Chuck Berry rhythm figures', '"Pride and Joy"'],
    nextMoves: ['up a 4th to the IV7', 'stack the 2 on top → a 9 chord, the funk cut of the same meat'],
  },
  {
    qualityId: 'm7b5',
    color: 'A m7 with the 5 squeezed down — dark and suspended in air, the "about to get serious" chord.',
    build: '1 b3 b5 b7.',
    pull: 'The ii of a minor two-five: leans hard up a 4th into a 7th chord (usually a 7b9).',
    uses: ['the ii of every minor turnaround — the "I Will Survive" walk lands here right before the V', 'minor-key soul ballads heading home'],
    nextMoves: ['up a 4th to a 7b9, then up a 4th again to the minor home', 'raise b5 back to 5 → plain m7 and the darkness lifts'],
  },
  {
    qualityId: 'dim7',
    color: 'The symmetric elevator — every note is a b3 apart, so every note can be the root.',
    build: 'Stacked b3s: 1 b3 b5 6, and the next b3 up is the octave.',
    pull: 'Pure passing chord — bridges two chords a whole step apart, or slides up a half step into a minor.',
    uses: ['gospel bass walk-ups: I, a dim7 a half step up, then the ii', 'the dramatic held chord in old ballads before the singer comes back'],
    nextMoves: ['slide the whole grip 3 frets either way — it is the same chord', 'resolve up a half step to whatever the bass was walking toward'],
  },
  {
    qualityId: 'minMaj7',
    color: 'The James Bond sting — a minor triad with a natural-7 shine that does not belong, on purpose.',
    build: 'Minor triad + the natural 7: 1 b3 5 7.',
    pull: 'Usually one step of a walk: minor → mMaj7 → m7 as the top note falls a fret at a time.',
    uses: ['the Bond-theme final chord', 'the "Something"-style descending line inside a held minor chord'],
    nextMoves: ['drop the 7 to b7 → m7 and finish the walk', 'hold it a beat longer than feels safe — that is the drama'],
  },
  {
    qualityId: '6',
    color: 'The doo-wop ending sweetener — major with a 6 instead of any 7, sweet and completely at rest.',
    build: 'Major triad + 6: 1 3 5 6.',
    pull: 'Happy to sit — it is how bands end a tune when maj7 feels too fancy.',
    uses: ['the last chord of a thousand doo-wop and soul records', 'western-swing comping where every chord is a 6'],
    nextMoves: ['raise the 6 a half step → dom7 and sweet turns bluesy', 'add the 2 as well for the 6/9 shimmer'],
  },
  {
    qualityId: 'm6',
    color: 'Dorian color in one grip — minor with a bright natural 6 where the ear expects the dark b6.',
    build: 'Minor triad + the natural 6: 1 b3 5 6.',
    pull: 'Vamps beautifully; the 6 keeps a minor groove from ever getting gloomy.',
    uses: ['"Oye Como Va"-style two-chord dorian vamps', 'the spooky-sweet held chord in old noir ballads'],
    nextMoves: ['swap the 6 for b7 → m7, dorian either way', 'walk 6 → b7 on top while the grip holds — instant movement'],
  },
  {
    qualityId: 'add9',
    color: 'The 9 sparkle WITHOUT the b7 — clean shimmer on a plain triad; not the same as a 9 chord, which carries the b7 too.',
    build: 'Major triad + the 2 (call it 9 when it rings up top) — no b7 anywhere.',
    pull: 'Happy to sit; it is a major chord in nicer clothes.',
    uses: ['"Purple Rain"-style ringing triads', 'ballad intros where a plain major sounds too plain'],
    nextMoves: ['add the b7 and it becomes a true 9 chord — James Brown territory', 'drop the 3 → sus2 and the shimmer turns to haze'],
  },
  {
    qualityId: 'madd9',
    color: 'Minor with the 9 sparkle and no b7 — moody but shiny, rain on glass.',
    build: 'Minor triad + the 2, no b7: the 2 rubbing against b3 makes the shimmer.',
    pull: 'Sits and glows; the rub is the point, not a tension to fix.',
    uses: ['moody intros and outros where plain minor is too flat', 'arpeggiated figures — the 2 and b3 ring prettier picked than strummed'],
    nextMoves: ['add the b7 → m9, the full quiet-storm pad', 'drop the 2 → plain minor to settle the air'],
  },
  {
    qualityId: '7sus4',
    color: 'A dom7 with the 4 where the 3 should be — floating, hazy, backdoor soul.',
    build: '1 4 5 b7 — no third.',
    pull: 'Classically the 4 falls to 3 for a plain 7th; soul records just let it float.',
    uses: ['the "What\'s Going On" haze', 'the gospel hang-here chord right before the release'],
    nextMoves: ['let the 4 fall to 3 → plain dom7', 'add the 2 → 9sus4 for the full Marvin wash'],
  },
  {
    qualityId: 'maj9',
    color: 'maj7 with the 2 stacked on — the plushest home sound, silk on silk.',
    build: '1 3 5 7 + the 2 up top.',
    pull: 'Happy to sit; nothing this comfortable wants to leave.',
    uses: ['quiet-storm ballads', 'Stevie-style slow ones where the I chord is a whole mood'],
    nextMoves: ['drop the 7 a half step → a 9 chord and the silk turns to funk', 'thin it back to maj7 when the band gets busy'],
  },
  {
    qualityId: 'min9',
    color: 'A m7 with the 2 stacked on — smoother and darker at once; the quiet-storm workhorse.',
    build: '1 b3 5 b7 + the 2.',
    pull: 'Vamps forever; it is the m7 in a better suit.',
    uses: ['slow-jam vamps — one m9 can carry a whole verse', 'the ii chord dressed up for a ballad'],
    nextMoves: ['add the 4 → m11, the full pad', 'strip back to m7 when the mix gets muddy'],
  },
  {
    qualityId: 'dom9',
    color: 'A dom7 with the 2 stacked on — the James Brown stab; funk in one grip.',
    build: '1 3 5 b7 + the 2.',
    pull: 'Same lean as any 7th — up a 4th — but funk parks on it all night.',
    uses: ['James Brown one-chord funk — the "Sex Machine" stab', 'the sweeter V in soul blues'],
    nextMoves: ['slide the whole grip down a whole step and back — the classic funk move', 'up a 4th, like any 7th chord, when the tune finally moves'],
  },
  {
    qualityId: '9sus4',
    color: 'The 9 chord with the 4 instead of the 3 — smooth, hazy, going nowhere on purpose.',
    build: '1 4 5 b7 + the 2 — no third.',
    pull: 'Floats; drop the 4 to 3 whenever you want it to finally commit.',
    uses: ['the hovering V in "What\'s Going On" — the chord that never quite lands', 'the gospel V that hovers instead of landing'],
    nextMoves: ['drop the 4 to 3 → dom9', 'just sit — the not-landing is the sound'],
  },
  {
    qualityId: 'min11',
    color: 'The quiet-storm pad — a whole cloud of minor pentatonic ringing at once.',
    build: 'The entire minor pentatonic (1 b3 4 5 b7) + the 2: 1 2 b3 4 5 b7.',
    pull: 'Happy to sit — one strum and the room changes.',
    uses: ['quiet-storm intros and outros', 'the held chord under a spoken intro on a soul record'],
    nextMoves: ['thin to m9 or m7 as the groove needs air', 'up a 4th and it resolves like a dressed-up two-five'],
  },
  {
    qualityId: '13',
    color: 'The whole rainbow over a dom7 — the 6 (call it 13) shining on top of the blues chord.',
    build: 'The entire major pentatonic (1 2 3 5 6) with a b7 stirred in.',
    pull: 'Same lean as any 7th — up a 4th — but jazz-blues comping parks on it.',
    uses: ['jazz-blues comping, T-Bone and Kenny Burrell style', 'the fancy final V before a turnaround'],
    nextMoves: ['strip to a 9 or plain 7 when it gets too thick', 'up a 4th to the IV13 and keep the rainbow going'],
  },
  {
    qualityId: '7#9',
    color: 'The Hendrix chord — major and minor third fighting in one grip; a 7th with a snarl.',
    build: 'dom7 + the b3 stacked up top (#9 is just the b3 an octave up).',
    pull: 'Wants to hit hard more than it wants to go anywhere — funk and rock live on it.',
    uses: ['"Purple Haze"', 'funk stabs when a plain 9 chord is too polite'],
    nextMoves: ['ease the #9 down a half step to the 2 → a regular 9 chord', 'up a 4th if the song insists on resolving'],
  },
  {
    qualityId: '7b9',
    color: 'The gospel/jazz V leaning HARD into home — dark, urgent, every note pointing at the resolution.',
    build: 'dom7 + the b2 up top (b9): 1 b2 3 5 b7.',
    pull: 'Falls up a 4th, badly — usually onto a minor chord.',
    uses: ['the V in minor gospel turnarounds', 'the second chord of a two-five into a minor, all over soul-jazz ballads'],
    nextMoves: ['up a 4th to the minor home (or its m7)', 'notice the 3, 5, b7, b9 make a dim7 — slide that top in b3s while the bass holds'],
  },
  {
    qualityId: 'maj7no5',
    color: 'A maj7 shell — 1 3 7 with the 5 staying home; same shimmer, less hand.',
    build: '1 3 7 — the maj7 minus its 5 (you will not miss it).',
    pull: 'Same as maj7: happy to sit. The namer uses this label when it hears a maj7 with no 5.',
    uses: ['comping shells when the bass player has the 5 covered'],
    nextMoves: ['add the 5 back → full maj7', 'drop the 7 a half step → a bluesy 7th shell'],
  },
  {
    qualityId: '5',
    color: 'The power chord — no third, no opinion, just weight.',
    build: '1 5, plus the octave if you want more of it.',
    pull: 'Goes wherever your fretting hand goes; it carries motion, not tension.',
    uses: ['rock riffs and anything through a loud amp', 'doubling a bass line without picking major or minor'],
    nextMoves: ['add the 3 or b3 and it finally picks a side', 'slide the grip in whole steps — parallel motion is the point'],
  },
]

const LORE_BY_ID = new Map(QUALITY_LORE.map((l) => [l.qualityId, l]))

export function loreFor(qualityId: string): QualityLore | undefined {
  return LORE_BY_ID.get(qualityId)
}

export interface FlavorGroup {
  name: string
  ids: string[]
}

// Chord Library picker layout. 'maj7no5' is deliberately absent: it is an
// identification-only alias, not a flavor anyone reaches for.
export const FLAVOR_GROUPS: FlavorGroup[] = [
  { name: 'Triads & power', ids: ['maj', 'min', 'dim', 'aug', '5'] },
  { name: 'Sus — no third', ids: ['sus2', 'sus4', '7sus4', '9sus4'] },
  { name: 'Sixths & adds', ids: ['6', 'm6', 'add9', 'madd9'] },
  { name: 'Sevenths', ids: ['dom7', 'maj7', 'min7', 'm7b5', 'dim7', 'minMaj7'] },
  { name: 'Ninths & up', ids: ['dom9', 'maj9', 'min9', 'min11', '13'] },
  { name: 'Spice', ids: ['7#9', '7b9'] },
]
