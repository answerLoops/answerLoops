const ENV_MINUTES = Number(process.env.ROI_MINUTES_PER_TICKET ?? 10)
const ENV_RATE = Number(process.env.ROI_STAFF_HOURLY_RATE ?? 50)

interface ROISavings {
  deflected: number
  hoursSaved: number
  dollarsSaved: number
  minutesPerTicket: number
  hourlyRate: number
}

interface ROIConfig {
  minutesPerTicket?: number | null
  staffHourlyRate?: number | null
}

export function computeSavings(deflected: number, config?: ROIConfig): ROISavings {
  const minutesPerTicket = config?.minutesPerTicket ?? ENV_MINUTES
  const hourlyRate = config?.staffHourlyRate ?? ENV_RATE
  const hoursSaved = (deflected * minutesPerTicket) / 60
  return {
    deflected,
    hoursSaved,
    dollarsSaved: hoursSaved * hourlyRate,
    minutesPerTicket,
    hourlyRate,
  }
}

export function deflectionRate(deflected: number, answered: number): number {
  return answered > 0 ? deflected / answered : 0
}
