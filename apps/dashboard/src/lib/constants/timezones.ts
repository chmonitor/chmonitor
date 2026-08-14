// Comprehensive list of IANA timezones organized by region with groups
export const TIMEZONE_GROUPS = [
  {
    label: 'North America',
    timezones: [
      { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
      { value: 'America/New_York', label: 'Eastern Time (ET)' },
      { value: 'America/Chicago', label: 'Central Time (CT)' },
      { value: 'America/Denver', label: 'Mountain Time (MT)' },
      { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
      { value: 'America/Anchorage', label: 'Alaska Time (AKST)' },
      { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
      { value: 'America/Phoenix', label: 'Arizona (MST, no DST)' },
      { value: 'America/Toronto', label: 'Toronto' },
      { value: 'America/Vancouver', label: 'Vancouver' },
      { value: 'America/Mexico_City', label: 'Mexico City' },
    ],
  },
  {
    label: 'Europe & Africa',
    timezones: [
      { value: 'Europe/London', label: 'London (GMT/BST)' },
      { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
      { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
      { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
      { value: 'Europe/Rome', label: 'Rome (CET/CEST)' },
      { value: 'Europe/Madrid', label: 'Madrid (CET/CEST)' },
      { value: 'Europe/Zurich', label: 'Zurich (CET/CEST)' },
      { value: 'Europe/Vienna', label: 'Vienna (CET/CEST)' },
      { value: 'Europe/Stockholm', label: 'Stockholm (CET/CEST)' },
      { value: 'Europe/Copenhagen', label: 'Copenhagen (CET/CEST)' },
      { value: 'Europe/Helsinki', label: 'Helsinki (EET/EEST)' },
      { value: 'Europe/Athens', label: 'Athens (EET/EEST)' },
      { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
      { value: 'Europe/Istanbul', label: 'Istanbul (TRT)' },
      { value: 'Africa/Cairo', label: 'Cairo (EET)' },
      { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
      { value: 'Africa/Lagos', label: 'Lagos (WAT)' },
      { value: 'Africa/Nairobi', label: 'Nairobi (EAT)' },
    ],
  },
  {
    label: 'Asia',
    timezones: [
      { value: 'Asia/Dubai', label: 'Dubai (GST)' },
      { value: 'Asia/Riyadh', label: 'Riyadh (AST)' },
      { value: 'Asia/Tehran', label: 'Tehran (IRST)' },
      { value: 'Asia/Karachi', label: 'Karachi (PKT)' },
      { value: 'Asia/Mumbai', label: 'Mumbai (IST)' },
      { value: 'Asia/Kolkata', label: 'Kolkata (IST)' },
      { value: 'Asia/Dhaka', label: 'Dhaka (BST)' },
      { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
      { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
      { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (MYT)' },
      { value: 'Asia/Jakarta', label: 'Jakarta (WIB)' },
      { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
      { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
      { value: 'Asia/Taipei', label: 'Taipei (TST)' },
      { value: 'Asia/Seoul', label: 'Seoul (KST)' },
      { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
      { value: 'Asia/Manila', label: 'Manila (PST)' },
      { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh (ICT)' },
    ],
  },
  {
    label: 'Australia & Pacific',
    timezones: [
      { value: 'Australia/Perth', label: 'Perth (AWST)' },
      { value: 'Australia/Adelaide', label: 'Adelaide (ACST)' },
      { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
      { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
      { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
      { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' },
      { value: 'Pacific/Fiji', label: 'Fiji (FJT)' },
      { value: 'Pacific/Guam', label: 'Guam (ChST)' },
      { value: 'Pacific/Apia', label: 'Apia (WSST)' },
    ],
  },
  {
    label: 'South America',
    timezones: [
      { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (ART)' },
      { value: 'America/Sao_Paulo', label: 'São Paulo (BRT/BRST)' },
      { value: 'America/Santiago', label: 'Santiago (CLT/CLST)' },
      { value: 'America/Lima', label: 'Lima (PET)' },
      { value: 'America/Bogota', label: 'Bogota (COT)' },
      { value: 'America/Caracas', label: 'Caracas (VET)' },
      { value: 'America/Montevideo', label: 'Montevideo (UYT)' },
    ],
  },
] as const

export type TimeZoneValue =
  (typeof TIMEZONE_GROUPS)[number]['timezones'][number]['value']

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function timezoneLabel(value: string): string {
  for (const group of TIMEZONE_GROUPS) {
    const found = group.timezones.find((tz) => tz.value === value)
    if (found) return found.label
  }
  return value.replaceAll('_', ' ')
}
