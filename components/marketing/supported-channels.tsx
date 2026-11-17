import Link from 'next/link'
import { IntegrationIcon } from '@/components/marketing/integration-icon'
import { MARKETED_CHANNELS } from '@/lib/marketing/channels'

export const SUPPORTED_CHANNELS_LABEL = 'Works wherever your community asks'
interface SupportedChannelsProps{
    variant?: 'compact' | 'linked'
}

export function SupportedChannels({variant = 'linked'}: SupportedChannelsProps){
    if(variant ==='compact'){
        return(
            <>
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-500">
                    {SUPPORTED_CHANNELS_LABEL}
                </p>
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2" aria-label='Supported channels'>
                    {MARKETED_CHANNELS.map(({name, color}) => (
                        <li key = {name} title={name} className="flex items-center">
                            <IntegrationIcon name={name} color={color}/>
                            <span className="sr-only">{name}</span>
                        </li>
                    ))}
                </ul>
            </>
        )
    }
    return(
        <>
            <p>{SUPPORTED_CHANNELS_LABEL}</p>
            <ul>
                {MARKETED_CHANNELS.map(({name, href, color}) => (
                    <li key={href}>
                        <Link href={href}>
                            <IntegrationIcon name={name} color={color}/>
                            <span>{name}</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </>
    )
}