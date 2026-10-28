import { clampPage, PagePipe } from './table-paginator';

describe('table paginator', () => {
  const items = Array.from({ length: 23 }, (_, index) => index + 1);
  const pipe = new PagePipe();

  it('returns only the items of the requested page', () => {
    expect(pipe.transform(items, 1, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pipe.transform(items, 3, 10)).toEqual([21, 22, 23]);
  });

  it('moves to the last page when the list shrinks below the current page', () => {
    expect(clampPage(5, 23, 10)).toBe(3);
    expect(pipe.transform(items, 5, 10)).toEqual([21, 22, 23]);
  });

  it('handles empty lists', () => {
    expect(clampPage(2, 0, 10)).toBe(1);
    expect(pipe.transform([], 1, 10)).toEqual([]);
    expect(pipe.transform(null, 1, 10)).toEqual([]);
  });
});
