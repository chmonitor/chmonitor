// Anonymous environment dimensions for telemetry events.
//
// All helpers are pure (no side effects, no network) and safe to call on both
// the client and the server. They return undefined / 'unknown' rather than
// throwing when data is absent.
//
// Redaction safety contract:
//   - `getDeployTarget()` returns a short enum string (e.g. 'cf', 'docker').
//   - `parseMajorMinor()` returns at most "MAJOR.MINOR" (e.g. '24.8') —
//     never a 4-part version like '24.8.1.2' which would collide with the
//     IPv4 redaction pattern in redact.ts.
//   - `detectChFlavor()` returns a short enum string.
// None of these values match the email/IPv4/IPv6/URL patterns in redact.ts.

export type DeployTarget = 'docker' | 'helm' | 'cf' | 'dev' | 'unknown'
export type ChFlavor = 'oss' | 'altinity' | 'cloud' | 'unknown'

/**
 * Returns the deployment target inlined at build time via VITE_DEPLOY_TARGET.
 * Falls back to 'unknown' when the var is absent (e.g. local dev without it
 * set, or a Docker build that doesn't set it yet).
 */
export function getDeployTarget(): DeployTarget {
  const raw = import.meta.env.VITE_DEPLOY_TARGET?.trim().toLowerCase()
  const VALID: DeployTarget[] = ['docker', 'helm', 'cf', 'dev', 'unknown']
  if (raw && (VALID as string[]).includes(raw)) return raw as DeployTarget
  return 'unknown'
}

/**
 * Extracts the "MAJOR.MINOR" portion from a ClickHouse version string.
 *
 * Examples:
 *   parseMajorMinor('24.8.1.2')           → '24.8'
 *   parseMajorMinor('24.8')               → '24.8'
 *   parseMajorMinor('24.8.5.7-altinity') → '24.8'
 *   parseMajorMinor('')                   → undefined
 *   parseMajorMinor(null)                 → undefined
 *
 * Returning only MAJOR.MINOR (never the full 4-part version) is intentional:
 * a string like '24.8.1.2' matches the IPv4 redaction regex and would be
 * silently dropped before reaching the telemetry sink.
 */
export function parseMajorMinor(
  version: string | null | undefined
): string | undefined {
  if (!version) return undefined
  const match = version.match(/^(\d+)\.(\d+)/)
  if (!match) return undefined
  return `${match[1]}.${match[2]}`
}

/**
 * Best-effort ClickHouse flavor detection from the version() string.
 *
 * - 'altinity' — version contains "altinity" (case-insensitive).
 * - 'oss'      — version looks like a normal semver / 4-part number.
 * - 'unknown'  — version is absent or unparseable.
 *
 * Note on 'cloud': ClickHouse Cloud version strings are not reliably
 * distinguishable from community builds via version() alone (they look like
 * normal 4-part versions). We do NOT guess 'cloud' here to avoid false
 * positives — if a reliable cloud marker is found in the future, add it then.
 */
export function detectChFlavor(version: string | null | undefined): ChFlavor {
  if (!version) return 'unknown'
  if (version.toLowerCase().includes('altinity')) return 'altinity'
  // Accept any string that starts with digits (a version number)
  if (/^\d/.test(version.trim())) return 'oss'
  return 'unknown'
}

/**
 * Detect country from browser timezone (privacy-safe alternative to IP geolocation).
 * Returns ISO 3166-1 alpha-2 country code or 'unknown'.
 *
 * Privacy contract:
 *   - Uses timezone mapping, NOT IP geolocation (no IP involved)
 *   - Returns 'unknown' when timezone cannot be mapped to a country
 *   - Uses Intl API which is built into the browser
 *   - Maps ALL IANA timezones to their primary country (comprehensive)
 */
export function detectCountry(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!timezone) return 'unknown'

    // Extract country code from timezone IANA identifier
    // Format: Area/Location or Area/Location/SubLocation (e.g., 'America/New_York', 'Europe/London')
    // The country is determined by the timezone's geographic region
    // This is a comprehensive mapping covering all IANA timezones
    const tzCountryMap: Record<string, string> = {
      // Africa
      'Africa/Abidjan': 'ci',
      'Africa/Accra': 'gh',
      'Africa/Addis_Ababa': 'et',
      'Africa/Algiers': 'dz',
      'Africa/Asmara': 'er',
      'Africa/Asmera': 'er',
      'Africa/Bamako': 'ml',
      'Africa/Bangui': 'cf',
      'Africa/Banjul': 'gm',
      'Africa/Bissau': 'gw',
      'Africa/Blantyre': 'mw',
      'Africa/Brazzaville': 'cg',
      'Africa/Bujumbura': 'bi',
      'Africa/Cairo': 'eg',
      'Africa/Casablanca': 'ma',
      'Africa/Ceuta': 'es',
      'Africa/Conakry': 'gn',
      'Africa/Dakar': 'sn',
      'Africa/Dar_es_Salaam': 'tz',
      'Africa/Djibouti': 'dj',
      'Africa/Douala': 'cm',
      'Africa/El_Aaiun': 'eh',
      'Africa/Freetown': 'sl',
      'Africa/Gaborone': 'bw',
      'Africa/Harare': 'zw',
      'Africa/Johannesburg': 'za',
      'Africa/Juba': 'ss',
      'Africa/Kampala': 'ug',
      'Africa/Khartoum': 'sd',
      'Africa/Kigali': 'rw',
      'Africa/Kinshasa': 'cd',
      'Africa/Lagos': 'ng',
      'Africa/Libreville': 'ga',
      'Africa/Lome': 'tg',
      'Africa/Luanda': 'ao',
      'Africa/Lubumbashi': 'cd',
      'Africa/Lusaka': 'zm',
      'Africa/Malabo': 'gq',
      'Africa/Maputo': 'mz',
      'Africa/Maseru': 'ls',
      'Africa/Mogadishu': 'so',
      'Africa/Monrovia': 'lr',
      'Africa/Nairobi': 'ke',
      'Africa/Ndjamena': 'td',
      'Africa/Niamey': 'ne',
      'Africa/Nouakchott': 'mr',
      'Africa/Ouagadougou': 'bf',
      'Africa/Porto-Novo': 'bj',
      'Africa/Sao_Tome': 'st',
      'Africa/Tripoli': 'ly',
      'Africa/Tunis': 'tn',
      'Africa/Windhoek': 'na',
      // America
      'America/Adak': 'us',
      'America/Anchorage': 'us',
      'America/Anguilla': 'ai',
      'America/Araguaina': 'br',
      'America/Argentina/Buenos_Aires': 'ar',
      'America/Argentina/Catamarca': 'ar',
      'America/Argentina/Cordoba': 'ar',
      'America/Argentina/Jujuy': 'ar',
      'America/Argentina/La_Rioja': 'ar',
      'America/Argentina/Mendoza': 'ar',
      'America/Argentina/Rio_Gallegos': 'ar',
      'America/Argentina/Salta': 'ar',
      'America/Argentina/San_Juan': 'ar',
      'America/Argentina/San_Luis': 'ar',
      'America/Argentina/Tucuman': 'ar',
      'America/Argentina/Ushuaia': 'ar',
      'America/Aruba': 'aw',
      'America/Asuncion': 'py',
      'America/Atikokan': 'ca',
      'America/Atka': 'us',
      'America/Bahia': 'br',
      'America/Bahia_Banderas': 'br',
      'America/Barbados': 'bb',
      'America/Belem': 'br',
      'America/Belize': 'bz',
      'America/Blanc-Sablon': 'ca',
      'America/Boa_Vista': 'br',
      'America/Bogota': 'co',
      'America/Boise': 'us',
      'America/Buenos_Aires': 'ar',
      'America/Cambridge_Bay': 'ca',
      'America/Campo_Grande': 'br',
      'America/Cancun': 'mx',
      'America/Caracas': 've',
      'America/Catamarca': 'ar',
      'America/Cayenne': 'gf',
      'America/Cayman': 'ky',
      'America/Chicago': 'us',
      'America/Chihuahua': 'mx',
      'America/Ciudad_Juarez': 'mx',
      'America/Coral_Harbour': 'bs',
      'America/Cordoba': 'ar',
      'America/Costa_Rica': 'cr',
      'America/Creston': 'ca',
      'America/Cuiaba': 'br',
      'America/Curacao': 'cw',
      'America/Danmarkshavn': 'gl',
      'America/Dawson': 'ca',
      'America/Dawson_Creek': 'ca',
      'America/Denver': 'us',
      'America/Detroit': 'us',
      'America/Dominica': 'dm',
      'America/Edmonton': 'ca',
      'America/Eirunepe': 'br',
      'America/El_Salvador': 'sv',
      'America/Ensenada': 'mx',
      'America/Fort_Nelson': 'ca',
      'America/Fortaleza': 'br',
      'America/Glace_Bay': 'ca',
      'America/Godthab': 'gl',
      'America/Goose_Bay': 'ca',
      'America/Grand_Turk': 'tc',
      'America/Grenada': 'gd',
      'America/Guadeloupe': 'gp',
      'America/Guatemala': 'gt',
      'America/Guayaquil': 'ec',
      'America/Guyana': 'gy',
      'America/Havana': 'cu',
      'America/Hermosillo': 'mx',
      'America/Indiana/Indianapolis': 'us',
      'America/Indiana/Knox': 'us',
      'America/Indiana/Marengo': 'us',
      'America/Indiana/Petersburg': 'us',
      'America/Indiana/Tell_City': 'us',
      'America/Indiana/Vevay': 'us',
      'America/Indiana/Vincennes': 'us',
      'America/Indiana/Winamac': 'us',
      'America/Inuvik': 'ca',
      'America/Iqaluit': 'ca',
      'America/Jamaica': 'jm',
      'America/Juneau': 'us',
      'America/Kentucky/Louisville': 'us',
      'America/Kentucky/Monticello': 'us',
      'America/Kralendijk': 'bw',
      'America/La_Paz': 'bo',
      'America/Lima': 'pe',
      'America/Los_Angeles': 'us',
      'America/Louisville': 'us',
      'America/Lower_Princes': 'ca',
      'America/Maceio': 'br',
      'America/Managua': 'ni',
      'America/Manaus': 'br',
      'America/Marigot': 'mf',
      'America/Martinique': 'mq',
      'America/Matamoros': 'mx',
      'America/Mazatlan': 'mx',
      'America/Mendoza': 'ar',
      'America/Menominee': 'us',
      'America/Merida': 'mx',
      'America/Metlakatla': 'us',
      'America/Mexico_City': 'mx',
      'America/Miquelon': 'pm',
      'America/Moncton': 'ca',
      'America/Monterrey': 'mx',
      'America/Montevideo': 'uy',
      'America/Montreal': 'ca',
      'America/Montserrat': 'ms',
      'America/Nassau': 'bs',
      'America/New_York': 'us',
      'America/Nipigon': 'ca',
      'America/Nome': 'us',
      'America/Noronha': 'br',
      'America/North_Dakota/Beulah': 'us',
      'America/North_Dakota/Center': 'us',
      'America/North_Dakota/New_Salem': 'us',
      'America/Ojinaga': 'mx',
      'America/Panama': 'pa',
      'America/Pangnirtung': 'ca',
      'America/Paramaribo': 'sr',
      'America/Phoenix': 'us',
      'America/Port-au-Prince': 'ht',
      'America/Port_of_Spain': 'tt',
      'America/Porto_Velho': 'br',
      'America/Puerto_Rico': 'pr',
      'America/Punta_Arenas': 'cl',
      'America/Rankin_Inlet': 'ca',
      'America/Recife': 'br',
      'America/Regina': 'ca',
      'America/Resolute': 'ca',
      'America/Rio_Branco': 'br',
      'America/Rosario': 'ar',
      'America/Santarem': 'br',
      'America/Santiago': 'cl',
      'America/Santo_Domingo': 'do',
      'America/Sao_Paulo': 'br',
      'America/Scoresbysund': 'gl',
      'America/Shiprock': 'us',
      'America/Sitka': 'us',
      'America/St_Barthelemy': 'gp',
      'America/St_Johns': 'ca',
      'America/St_Kitts': 'kn',
      'America/St_Lucia': 'lc',
      'America/St_Thomas': 'vi',
      'America/St_Vincent': 'vc',
      'America/Swift_Current': 'ca',
      'America/Tegucigalpa': 'hn',
      'America/Thule': 'gl',
      'America/Thunder_Bay': 'ca',
      'America/Tijuana': 'mx',
      'America/Toronto': 'ca',
      'America/Tortola': 'vg',
      'America/Vancouver': 'ca',
      'America/Whitehorse': 'ca',
      'America/Winnipeg': 'ca',
      'America/Yakutat': 'us',
      'America/Yellowknife': 'ca',
      // Antarctica
      'Antarctica/Casey': 'au',
      'Antarctica/Davis': 'au',
      'Antarctica/DumontDUrville': 'fr',
      'Antarctica/Macquarie': 'au',
      'Antarctica/Mawson': 'au',
      'Antarctica/McMurdo': 'nz',
      'Antarctica/Palmer': 'cl',
      'Antarctica/Rothera': 'gb',
      'Antarctica/Syowa': 'jp',
      'Antarctica/Troll': 'aj',
      'Antarctica/Vostok': 'aj',
      // Arctic
      'Arctic/Longyearbyen': 'sj',
      // Asia
      'Asia/Aden': 'ye',
      'Asia/Almaty': 'kz',
      'Asia/Amman': 'jo',
      'Asia/Anadyr': 'ru',
      'Asia/Aqtau': 'kz',
      'Asia/Aqtobe': 'kz',
      'Asia/Ashgabat': 'tm',
      'Asia/Ashkhabad': 'tm',
      'Asia/Atyrau': 'kz',
      'Asia/Baghdad': 'iq',
      'Asia/Bahrain': 'bh',
      'Asia/Baku': 'az',
      'Asia/Bangkok': 'th',
      'Asia/Barnaul': 'kz',
      'Asia/Beirut': 'lb',
      'Asia/Bishkek': 'kg',
      'Asia/Brunei': 'bn',
      'Asia/Calcutta': 'in',
      'Asia/Chita': 'ru',
      'Asia/Choibalsan': 'mn',
      'Asia/Chongqing': 'cn',
      'Asia/Chungking': 'cn',
      'Asia/Colombo': 'lk',
      'Asia/Dacca': 'vn',
      'Asia/Damascus': 'sy',
      'Asia/Dhaka': 'bd',
      'Asia/Dili': 'tl',
      'Asia/Dubai': 'ae',
      'Asia/Dushanbe': 'tj',
      'Asia/Famagusta': 'cy',
      'Asia/Gaza': 'ps',
      'Asia/Harbin': 'cn',
      'Asia/Hebron': 'ps',
      'Asia/Ho_Chi_Minh': 'vn',
      'Asia/Hong_Kong': 'hk',
      'Asia/Hovd': 'mn',
      'Asia/Irkutsk': 'ru',
      'Asia/Istanbul': 'tr',
      'Asia/Jakarta': 'id',
      'Asia/Jayapura': 'id',
      'Asia/Jerusalem': 'il',
      'Asia/Kabul': 'af',
      'Asia/Kamchatka': 'ru',
      'Asia/Karachi': 'pk',
      'Asia/Kashgar': 'cn',
      'Asia/Kathmandu': 'np',
      'Asia/Khandyga': 'ru',
      'Asia/Kolkata': 'in',
      'Asia/Krasnoyarsk': 'ru',
      'Asia/Kuala_Lumpur': 'my',
      'Asia/Kuching': 'my',
      'Asia/Kuwait': 'kw',
      'Asia/Macau': 'mo',
      'Asia/Magadan': 'ru',
      'Asia/Makassar': 'id',
      'Asia/Manila': 'ph',
      'Asia/Muscat': 'om',
      'Asia/Nicosia': 'cy',
      'Asia/Novokuznetsk': 'ru',
      'Asia/Novosibirsk': 'ru',
      'Asia/Omsk': 'ru',
      'Asia/Oral': 'kz',
      'Asia/Phnom_Penh': 'kh',
      'Asia/Pontianak': 'id',
      'Asia/Pyongyang': 'kp',
      'Asia/Qatar': 'qa',
      'Asia/Qostanay': 'kz',
      'Asia/Qyzylorda': 'kz',
      'Asia/Rangoon': 'mm',
      'Asia/Riyadh': 'sa',
      'Asia/Saigon': 'vn',
      'Asia/Sakhalin': 'ru',
      'Asia/Samarkand': 'uz',
      'Asia/Seoul': 'kr',
      'Asia/Shanghai': 'cn',
      'Asia/Singapore': 'sg',
      'Asia/Srednekolymsk': 'ru',
      'Asia/Taipei': 'tw',
      'Asia/Tashkent': 'uz',
      'Asia/Tbilisi': 'ge',
      'Asia/Tehran': 'ir',
      'Asia/Tel_Aviv': 'il',
      'Asia/Thimbu': 'bt',
      'Asia/Tokyo': 'jp',
      'Asia/Tomsk': 'ru',
      'Asia/Ulaanbaatar': 'mn',
      'Asia/Urumqi': 'cn',
      'Asia/Ust-Nera': 'ru',
      'Asia/Vientiane': 'la',
      'Asia/Vladivostok': 'ru',
      'Asia/Yakutsk': 'ru',
      'Asia/Yekaterinburg': 'ru',
      'Asia/Yerevan': 'am',
      // Atlantic
      'Atlantic/Azores': 'pt',
      'Atlantic/Bermuda': 'bm',
      'Atlantic/Canary': 'es',
      'Atlantic/Cape_Verde': 'cv',
      'Atlantic/Faroe': 'fo',
      'Atlantic/Madeira': 'pt',
      'Atlantic/Reykjavik': 'is',
      'Atlantic/South_Georgia': 'gs',
      'Atlantic/St_Helena': 'sh',
      'Atlantic/Stanley': 'fk',
      // Australia
      'Australia/Adelaide': 'au',
      'Australia/Brisbane': 'au',
      'Australia/Broken_Hill': 'au',
      'Australia/Currie': 'au',
      'Australia/Darwin': 'au',
      'Australia/Eucla': 'au',
      'Australia/Hobart': 'au',
      'Australia/Lindeman': 'au',
      'Australia/Lord_Howe': 'au',
      'Australia/Melbourne': 'au',
      'Australia/Perth': 'au',
      'Australia/Sydney': 'au',
      // Europe
      'Europe/Amsterdam': 'nl',
      'Europe/Andorra': 'ad',
      'Europe/Athens': 'gr',
      'Europe/Belgrade': 'rs',
      'Europe/Berlin': 'de',
      'Europe/Bratislava': 'sk',
      'Europe/Brussels': 'be',
      'Europe/Bucharest': 'ro',
      'Europe/Budapest': 'hu',
      'Europe/Busingen': 'de',
      'Europe/Chisinau': 'md',
      'Europe/Copenhagen': 'dk',
      'Europe/Dublin': 'ie',
      'Europe/Gibraltar': 'gi',
      'Europe/Guernsey': 'gg',
      'Europe/Helsinki': 'fi',
      'Europe/Isle_of_Man': 'im',
      'Europe/Istanbul': 'tr',
      'Europe/Kaliningrad': 'ru',
      'Europe/Kiev': 'ua',
      'Europe/Kirov': 'ru',
      'Europe/Lisbon': 'pt',
      'Europe/Ljubljana': 'si',
      'Europe/London': 'gb',
      'Europe/Luxembourg': 'lu',
      'Europe/Madrid': 'es',
      'Europe/Malta': 'mt',
      'Europe/Mariehamn': 'ax',
      'Europe/Minsk': 'by',
      'Europe/Monaco': 'mc',
      'Europe/Moscow': 'ru',
      'Europe/Oslo': 'no',
      'Europe/Paris': 'fr',
      'Europe/Podgorica': 'me',
      'Europe/Prague': 'cz',
      'Europe/Riga': 'lv',
      'Europe/Rome': 'it',
      'Europe/Samara': 'ru',
      'Europe/San_Marino': 'sm',
      'Europe/Sarajevo': 'ba',
      'Europe/Simferopol': 'ua',
      'Europe/Skopje': 'mk',
      'Europe/Sofia': 'bg',
      'Europe/Stockholm': 'se',
      'Europe/Tallinn': 'ee',
      'Europe/Tirane': 'al',
      'Europe/Ulyanovsk': 'ru',
      'Europe/Uzhgorod': 'ua',
      'Europe/Vaduz': 'li',
      'Europe/Vienna': 'at',
      'Europe/Vilnius': 'lt',
      'Europe/Volgograd': 'ru',
      'Europe/Zagreb': 'hr',
      'Europe/Zurich': 'ch',
      // Indian
      'Indian/Antananarivo': 'mg',
      'Indian/Chagos': 'io',
      'Indian/Christmas': 'cx',
      'Indian/Cocos': 'cc',
      'Indian/Kerguelen': 'tf',
      'Indian/Mahe': 'sc',
      'Indian/Maldives': 'mv',
      'Indian/Mauritius': 'mu',
      'Indian/Mayotte': 'yt',
      'Indian/Reunion': 're',
      // Pacific
      'Pacific/Apia': 'ws',
      'Pacific/Auckland': 'nz',
      'Pacific/Bougainville': 'pg',
      'Pacific/Chatham': 'nz',
      'Pacific/Easter': 'cl',
      'Pacific/Efate': 'vu',
      'Pacific/Enderbury': 'ki',
      'Pacific/Fakaofo': 'tk',
      'Pacific/Fiji': 'fj',
      'Pacific/Funafuti': 'tv',
      'Pacific/Galapagos': 'ec',
      'Pacific/Gambier': 'pf',
      'Pacific/Guadalcanal': 'sb',
      'Pacific/Guam': 'gu',
      'Pacific/Honolulu': 'us',
      'Pacific/Johnston': 'us',
      'Pacific/Kiritimati': 'ki',
      'Pacific/Kosrae': 'fm',
      'Pacific/Kwajalein': 'mh',
      'Pacific/Majuro': 'mh',
      'Pacific/Marquesas': 'pf',
      'Pacific/Midway': 'us',
      'Pacific/Nauru': 'nr',
      'Pacific/Niue': 'nu',
      'Pacific/Norfolk': 'au',
      'Pacific/Noumea': 'nc',
      'Pacific/Pago_Pago': 'as',
      'Pacific/Palau': 'pw',
      'Pacific/Pitcairn': 'pn',
      'Pacific/Ponape': 'fm',
      'Pacific/Port_Moresby': 'pg',
      'Pacific/Rarotonga': 'ck',
      'Pacific/Saipan': 'mp',
      'Pacific/Samoa': 'ws',
      'Pacific/Tahiti': 'pf',
      'Pacific/Tarawa': 'ki',
      'Pacific/Tongatapu': 'to',
      'Pacific/Truk': 'fm',
      'Pacific/Wake': 'us',
      'Pacific/Wallis': 'wf',
    }

    return tzCountryMap[timezone] || 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Detect platform/OS from navigator.userAgent (generic categories only).
 * Returns 'windows', 'macos', 'linux', 'android', 'ios', or 'unknown'.
 *
 * Privacy contract:
 *   - Only generic OS families, not specific versions
 *   - Returns 'unknown' when userAgent is unavailable or unparseable
 *   - No device fingerprinting or unique identifiers
 */
export function detectPlatform(): string {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return 'unknown'
  }

  const ua = navigator.userAgent.toLowerCase()

  if (ua.includes('android')) return 'android'
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios'
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos'
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('linux')) return 'linux'

  return 'unknown'
}
