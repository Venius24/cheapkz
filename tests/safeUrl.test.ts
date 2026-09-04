import { describe, expect, it } from 'vitest'
import { assertPublicUrl, isPrivateAddress } from '../src/http/safeUrl.js'
import { SourceError } from '../src/http/errors.js'

describe('SSRF-защита', () => {
  it('внутренние IPv4 распознаются', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })
  it('публичные IPv4 проходят', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.167.1.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })
  it('внутренние IPv6 распознаются', () => {
    for (const ip of ['::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
  })
  it('мусор считается небезопасным', () => {
    expect(isPrivateAddress('не-адрес')).toBe(true)
  })

  it('метаданные облака блокируются', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(SourceError)
  })
  it('localhost блокируется', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:8080/api')).rejects.toThrow(/внутренней сети/)
  })
  it('не-HTTP схемы блокируются', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/схема/)
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toThrow(/схема/)
  })
  it('невалидный URL -> CONFIG', async () => {
    await expect(assertPublicUrl('не url')).rejects.toMatchObject({ code: 'CONFIG' })
  })
  it('allowPrivate снимает проверку осознанно', async () => {
    const u = await assertPublicUrl('http://127.0.0.1:8080/api', true)
    expect(u.hostname).toBe('127.0.0.1')
  })
  it('публичный хост проходит', async () => {
    const u = await assertPublicUrl('https://8.8.8.8/x')
    expect(u.protocol).toBe('https:')
  })
})
