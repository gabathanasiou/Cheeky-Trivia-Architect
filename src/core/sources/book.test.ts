import { describe, expect, it } from 'vitest';
import { parseBook, splitBookSections, stripGutenberg } from './book';

const SAMPLE = `Project Gutenberg header
*** START OF THE PROJECT GUTENBERG EBOOK INVENTION AND DISCOVERY ***

CONTENTS.

   Alpha                                                   1
   Beta                                                    2

------------------------------------------------------------------------

                        ALPHA SECTION.

In 1828, the river broke into the tunnel and filled it in ten minutes.
Six of the workmen were lost.

------------------------------------------------------------------------

                        BETA SECTION.

A machine weighed thirty-five thousand sovereigns in one day.

*** END OF THE PROJECT GUTENBERG EBOOK INVENTION AND DISCOVERY ***
Project Gutenberg footer`;

describe('stripGutenberg', () => {
  it('removes the header and footer', () => {
    const body = stripGutenberg(SAMPLE);
    expect(body).not.toContain('Project Gutenberg header');
    expect(body).not.toContain('Project Gutenberg footer');
    expect(body).toContain('ALPHA SECTION');
  });
});

describe('splitBookSections', () => {
  it('splits on the long dash separators and skips contents', () => {
    const sections = splitBookSections(stripGutenberg(SAMPLE));
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('ALPHA SECTION');
    expect(sections[1].heading).toBe('BETA SECTION');
  });

  it('stops at the publisher catalogue', () => {
    const withAds = SAMPLE.replace(
      '*** END OF',
      `------------------------------------------------------------------------

                        CATALOGUE OF

Nimmo's books, price 3s., cloth extra.

*** END OF`,
    );
    const sections = splitBookSections(stripGutenberg(withAds));
    expect(sections.map((section) => section.heading)).toEqual([
      'ALPHA SECTION',
      'BETA SECTION',
    ]);
  });

  it('keeps the section body intact for quote anchoring', () => {
    const sections = splitBookSections(stripGutenberg(SAMPLE));
    expect(sections[0].text).toContain('Six of the workmen were lost.');
  });
});

describe('parseBook', () => {
  it('parses the sample end-to-end', () => {
    const sections = parseBook(SAMPLE);
    expect(sections.map((section) => section.heading)).toEqual([
      'ALPHA SECTION',
      'BETA SECTION',
    ]);
  });
});
