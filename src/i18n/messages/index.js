// Translations of the interface, by area: { key: { es, ca } } (and en when the key is an identifier).
// docs/i18n/translations.xlsx is generated from these files for review (npm run i18n:export).
import header     from './header'
import processor  from './processor'
import program    from './program'
import simulation from './simulation'
import analysis   from './analysis'
import timeline   from './timeline'
import tutorial   from './tutorial'
import lesson     from './lesson'
import editors    from './editors'
import checks     from './checks'
import help       from './help'

export const AREAS = { header, processor, program, simulation, analysis, timeline, tutorial, lesson, editors, checks, help }
export const MESSAGES = Object.assign({}, ...Object.values(AREAS))
