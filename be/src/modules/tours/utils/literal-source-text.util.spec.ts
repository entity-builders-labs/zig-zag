import {
  foldLiteralText,
  literalOccurrences,
  sameLiteralName,
  sourceStatements,
  textNamesLiterally,
} from './literal-source-text.util';

/** Synthetic fixtures: they test Unicode handling and literal matching,
 * not that any business exists. */
describe('literal source text', () => {
  describe('textNamesLiterally', () => {
    it.each([
      [
        'Latin, whole words',
        'Wine and lunch at Ojo de Agua in Lujan de Cuyo',
        'Ojo de Agua',
        true,
      ],
      [
        'Latin diacritics are folded',
        'Wine and lunch at Ojo de Agua in Lujan de Cuyo',
        'Luján de Cuyo',
        true,
      ],
      [
        'Latin partial word is not a name',
        'Lunch at Ojo de Aguada',
        'Ojo de Agua',
        false,
      ],
      [
        'Japanese name in an unspaced sentence',
        '青山カフェは東京都渋谷区にあります。',
        '青山カフェ',
        true,
      ],
      [
        'Japanese locality in an unspaced sentence',
        '青山カフェは東京都渋谷区にあります。',
        '渋谷区',
        true,
      ],
      [
        'Japanese nested locality',
        '青山カフェは東京都渋谷区にあります。',
        '東京都渋谷区',
        true,
      ],
      [
        'Japanese name starting inside a word',
        '青山カフェは東京都渋谷区にあります。',
        '山カフェ',
        false,
      ],
      [
        'Japanese different name',
        '銀座カフェは東京都中央区にあります。',
        '青山カフェ',
        false,
      ],
      ['Japanese voiced mark is significant', 'ガイドツアー', 'カイド', false],
      [
        'English name next to Japanese text',
        'Blue Bottle Coffeeは渋谷区にあります。',
        'Blue Bottle Coffee',
        true,
      ],
      [
        'mixed-script names do not collapse to their Latin part',
        'Lunch at Café 渋谷 in Tokyo',
        'Café 青山',
        false,
      ],
      [
        'a different script never matches',
        '青山カフェは東京都渋谷区にあります。',
        'Tokyo',
        false,
      ],
      [
        'a transliteration never matches',
        '青山カフェは東京都渋谷区にあります。',
        'Aoyama Cafe',
        false,
      ],
      ['Cyrillic', 'Кафе Пушкин находится в Москве', 'Кафе Пушкин', true],
      ['Cyrillic short i is not i', 'Кафе Май', 'Кафе Маи', false],
      [
        'full-width Latin is unified',
        'Ｃａｆé Ｔｏｒｔｏｎｉ',
        'Cafe Tortoni',
        true,
      ],
      [
        'an empty or punctuation-only name never matches',
        'Anything at all',
        ' - ',
        false,
      ],
    ])('%s', (_label, text, name, expected) => {
      expect(textNamesLiterally(text, name)).toBe(expected);
    });

    it('fails closed for a name glued to a suffix kept in the same word (Korean particle)', () => {
      expect(textNamesLiterally('서울 강남구에 있는 카페', '강남구')).toBe(
        false,
      );
    });
  });

  it('keeps the previous Latin folding for ASCII and accented Latin text', () => {
    expect(foldLiteralText("Musée d'Orsay — Paris!")).toBe(
      'musee d orsay paris',
    );
    expect(foldLiteralText('LUJÁN de Cuyo')).toBe('lujan de cuyo');
  });

  it('reports every whole-word occurrence', () => {
    expect(
      literalOccurrences(
        'It took us 15 minutes to drive to Ojo de Agua from Ojo de Agua Norte',
        'Ojo de Agua',
      ),
    ).toHaveLength(2);
  });

  it('compares names literally', () => {
    expect(sameLiteralName('Ojo de Agua', 'ojo de agua')).toBe(true);
    expect(sameLiteralName('Café 青山', 'Café 渋谷')).toBe(false);
    expect(sameLiteralName('-', '–')).toBe(false);
  });

  describe('sourceStatements', () => {
    it('separates an image description from the caption written after it', () => {
      expect(
        sourceStatements(
          '![A bottle of wine on a table next to a basket of bread]()*Wine and lunch at Ojo de Agua in Lujan de Cuyo*',
        ),
      ).toEqual([
        'A bottle of wine on a table next to a basket of bread',
        'Wine and lunch at Ojo de Agua in Lujan de Cuyo',
      ]);
    });

    it('reduces links and emphasis to visible text and splits sentences, list entries and headings', () => {
      expect(
        sourceStatements(
          '### Lujan de Cuyo Itinerary\n3. [Ojo de Agua](https://ojodeagua.ch/) – 1:30 pm. Enjoy a *leisurely* lunch.',
        ),
      ).toEqual([
        'Lujan de Cuyo Itinerary',
        '3.',
        'Ojo de Agua – 1:30 pm.',
        'Enjoy a leisurely lunch.',
      ]);
    });

    it('splits Japanese sentences without spaces', () => {
      expect(
        sourceStatements(
          '青山カフェは東京都渋谷区にあります。次に銀座へ行きます。',
        ),
      ).toEqual([
        '青山カフェは東京都渋谷区にあります。',
        '次に銀座へ行きます。',
      ]);
    });
  });
});
