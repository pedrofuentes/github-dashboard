import { cn } from './cn';

describe('cn', () => {
  it('joins truthy class names with a single space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('ignores falsy values produced by conditional expressions', () => {
    const isActive = false;
    const isVisible = true;

    expect(cn('base', isActive && 'active', isVisible && 'visible')).toBe('base visible');
  });

  it('drops null, undefined and empty-string values', () => {
    expect(cn('a', null, undefined, '', 'b')).toBe('a b');
  });

  it('returns an empty string when no truthy values are provided', () => {
    expect(cn()).toBe('');
    expect(cn(false, null, undefined, '')).toBe('');
  });
});
