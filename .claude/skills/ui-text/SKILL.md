---
name: ui-text
description: Write or change interface text in English and Italian. The text reads as native, fits its place on screen and uses the words of the rest of the app. Use for any string in web/src/locales or desktop/internal/adapters/words.
argument-hint: "[feature, key or screen] [en | it | both]"
---

# Write interface text

Interface text is short, concrete and calm, in the manner of Apple's interface
copy. It is also friendly and plain: a writer who is not technical understands
it at once. A native speaker writes each language for native speakers.
It is never a translation.

Load `references/en.md` for English and `references/it.md` for Italian. Load
only the language that you write.

## 1. Read the context

1. Find where the text appears: the component, the route and the control
   (button, title, hint, error, empty state, confirmation, toast).
2. Read the component. Find its keys from its `t(` calls. One screen name can
   mean two components with different keys.
3. Find the moment in the flow of the writer and what the writer wants at
   that moment.
4. Find the space that the text has. A button label is not a sentence. Check
   the phone width too.

## 2. Understand the feature

Read the row of the feature in `docs/features.md` and its code. The text says
what the feature does for the writer. It does not say what the key is called
or how the code works.

## 3. Keep the words coherent

1. Search `web/src/locales/en.json` and `it.json` for the same feature and its
   neighbours: the same key prefix and the same nouns.
2. Read every string that shows on the same screen at the same moment, such
   as a greeting above a title. Do not repeat its words or its form.
3. Use the words that the app already uses for the same thing. The tables in
   the reference files list the fixed choices.
4. Follow `GLOSSARY.md` and its words to avoid.
5. Write `{{product}}` for the product name. Never write a name.
6. A new word for a thing that already has a word is a defect. If the old word
   is wrong, say so and propose a change everywhere, as a separate step.

## 4. Write from meaning

1. Write the meaning in one plain sentence for yourself first.
2. Write the first language from that meaning.
3. Write the second language again from the same meaning, not from the first
   text. Sentence structure, length and idiom may differ.
4. If the register is not certain, give two alternatives and say how they
   differ.
5. Put both languages in the same change. The desktop program keeps its words
   in `desktop/internal/adapters/words/`, with single braces such as
   `{product}`.

## 5. Check the language

If the host can search the web, check each word, collocation or register that
is not certain:

- Italian: Treccani, `https://www.treccani.it/vocabolario/<word>/`; Treccani
  synonyms, `https://www.treccani.it/vocabolario/<word>_(Sinonimi-e-Contrari)/`;
  [Accademia della Crusca, consulenza](https://accademiadellacrusca.it/it/consulenza).
- English: [Merriam-Webster](https://www.merriam-webster.com/),
  [Cambridge Dictionary](https://dictionary.cambridge.org/),
  [Oxford Learner's Dictionaries](https://www.oxfordlearnersdictionaries.com/).

Some dictionaries refuse an automated fetch. Then use the search result and
mark the page "search only". Do not invent a phrase that a native speaker
would not say. Name the pages that you used in the report.

## 6. Polish

- One idea in each string.
- Prefer a verb to a noun built from a verb.
- Say what the writer gets or must do, not the state of the system.
- No exclamation marks, except in a product name such as "Enlighten!".
- Follow the case, punctuation and quotes of the reference file.

## 7. Verify

1. Run `npm --prefix web test -- src/locales/locales.test.ts` (key parity,
   plurals, interpolation, vendor names, product name).
2. Run `npm --prefix web test -- src/product.test.ts` (no working name in
   shipped code).
3. For desktop words, run `go test ./internal/adapters/words/` in `desktop/`.
4. Open the screen and read the text in place at phone and desktop width. In
   Claude Code, use the `browser-check` skill.

## Report

For each string, give:

- the key;
- the English text and the Italian text, with the alternatives where the
  register was not certain;
- the sibling keys that you kept coherent with;
- the dictionary pages that you used.

The maintainer reads the Italian before it ships.
