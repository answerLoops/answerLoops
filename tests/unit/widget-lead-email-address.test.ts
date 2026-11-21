import { describe, expect, it } from 'vitest'
import { isAcceptableLeadEmail } from '@/lib/widget/lead-email-address'

/**
 * The address check for widget leads. A lead address ends up in an email to a
 * workspace's team and on their Leads page, so only plain, ordinary addresses
 * pass. These lists pin what is accepted and what is refused.
 */

describe('isAcceptableLeadEmail: accepted', () => {
  it.each([
    'visitor@example.com',
    'first.last@example.com',
    'first_last@example.co.uk',
    'name+tag@example.org',
    'a-b@sub.domain.example.io',
    'user123@example123.com',
    'x@ab.cd',
  ])('accepts %s', (address) => {
    expect(isAcceptableLeadEmail(address)).toBe(true)
  })
})

describe('isAcceptableLeadEmail: refused', () => {
  it.each([
    ['empty', ''],
    ['no at sign', 'visitor.example.com'],
    ['two at signs', 'a@b@example.com'],
    ['no domain dot', 'visitor@localhost'],
    ['path in the local part', 'evil.com/x@example.com'],
    ['a url as the local part', 'https://evil.test@example.com'],
    ['space', 'visitor @example.com'],
    ['space inside', 'visi tor@example.com'],
    ['angle brackets', '<visitor@example.com>'],
    ['display name', 'Name <visitor@example.com>'],
    ['quotes', '"visitor"@example.com'],
    ['single quote', "o'brien@example.com"],
    ['backslash', 'visi\\tor@example.com'],
    ['comma list', 'a@example.com,b@example.com'],
    ['semicolon list', 'a@example.com;b@example.com'],
    ['percent routing', 'a%b@example.com'],
    ['parentheses', 'visitor(comment)@example.com'],
    ['brackets', 'visitor[1]@example.com'],
    ['leading dot', '.visitor@example.com'],
    ['trailing dot in local part', 'visitor.@example.com'],
    ['double dot', 'vis..itor@example.com'],
    ['leading hyphen in a domain label', 'visitor@-example.com'],
    ['trailing hyphen in a domain label', 'visitor@example-.com'],
    ['double dot in the domain', 'visitor@example..com'],
    ['trailing dot in the domain', 'visitor@example.com.'],
    ['ip address domain', 'visitor@192.168.0.1'],
    ['ip literal', 'visitor@[192.168.0.1]'],
    ['numeric top level', 'visitor@example.123'],
    ['one letter top level', 'visitor@example.c'],
    ['top level with a hyphen', 'visitor@example.c-m'],
    ['underscore in the domain', 'visitor@exa_mple.com'],
    ['non-ascii local part', 'vísitor@example.com'],
    ['non-ascii domain', 'visitor@exämple.com'],
    ['newline', 'visitor@example.com\nbcc:other@example.com'],
    ['carriage return', 'visitor@example.com\r\nsubject:x'],
    ['tab', 'visitor\t@example.com'],
    ['null byte', 'visitor@exam\u0000ple.com'],
    ['local part over 64 characters', `${'a'.repeat(65)}@example.com`],
    ['over 254 characters', `a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(63)}.com`],
    ['a label over 63 characters', `a@${'b'.repeat(64)}.com`],
  ])('refuses %s', (_label, address) => {
    expect(isAcceptableLeadEmail(address)).toBe(false)
  })

  it('refuses anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, [], ['a@example.com']]) {
      expect(isAcceptableLeadEmail(value)).toBe(false)
    }
  })
})
