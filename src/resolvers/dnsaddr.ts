import { CodeError } from '@libp2p/interface'
import { dns, RecordType } from '@multiformats/dns'
import { raceSignal } from 'race-signal'
import { multiaddr } from '../index.js'
import { getProtocol } from '../protocols-table.js'
import type { Resolver } from './index.js'
import type { AbortOptions, Multiaddr } from '../index.js'
import type { DNS } from '@multiformats/dns'

const MAX_RECURSIVE_DEPTH = 32
const { code: dnsaddrCode } = getProtocol('dnsaddr')

export interface DNSADDROptions extends AbortOptions {
  /**
   * An optional DNS resolver
   */
  dns?: DNS

  /**
   * When resolving DNSADDR Multiaddrs that resolve to other DNSADDR Multiaddrs,
   * limit how many times we will recursively resolve them.
   *
   * @default 32
   */
  maxRecursiveDepth?: number
}

export const dnsaddrResolver: Resolver<DNSADDROptions> = async function dnsaddr (ma: Multiaddr, options: DNSADDROptions = {}): Promise<string[]> {
  const recursionLimit = options.maxRecursiveDepth ?? MAX_RECURSIVE_DEPTH

  if (recursionLimit === 0) {
    throw new CodeError('Max recursive depth reached', 'ERR_MAX_RECURSIVE_DEPTH_REACHED')
  }

  const [, hostname] = ma.stringTuples().find(([proto]) => proto === dnsaddrCode) ?? []

  const resolver = options?.dns ?? dns()
  const result = await raceSignal(resolver.query(`_dnsaddr.${hostname}`, {
    signal: options?.signal,
    types: [
      RecordType.TXT
    ]
  }), options.signal)

  const peerId = ma.getPeerId()
  const output: string[] = []

  for (const answer of result.Answer) {
    const addr = answer.data.split('=')[1]

    if (addr == null) {
      continue
    }

    if (peerId != null && !addr.includes(peerId)) {
      continue
    }

    const ma = multiaddr(addr)

    if (addr.startsWith('/dnsaddr')) {
      const resolved = await ma.resolve({
        ...options,
        maxRecursiveDepth: recursionLimit - 1
      })

      output.push(...resolved.map(ma => ma.toString()))
    } else {
      output.push(ma.toString())
    }
  }

  return output
}
