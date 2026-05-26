export type BusinessType = 'moving' | 'real_estate' | 'insurance' | 'cleaning' | 'legal' | 'general'

export interface LeadProfile {
  fields: string[]
  spamKeywords: string[]
  description: string
}

export const LEAD_PROFILES: Record<BusinessType, LeadProfile> = {
  moving: {
    description: 'Moving/relocation company',
    fields: ['movingDate', 'fromAddress', 'toAddress', 'moveSize', 'services'],
    spamKeywords: ['unsubscribe', 'invoice #', 'order confirmation', 'receipt', 'newsletter'],
  },
  real_estate: {
    description: 'Real estate agency',
    fields: ['propertyAddress', 'budget', 'viewingDate', 'buyerOrSeller', 'bedrooms', 'timeline'],
    spamKeywords: ['unsubscribe', 'invoice', 'newsletter', 'receipt'],
  },
  insurance: {
    description: 'Insurance broker or provider — covers home insurance (property type, bedrooms, current/new address, coverage types, moving date), car insurance (vehicle details, NCB, renewal date), life, health, and other policy types',
    fields: ['insuranceType', 'propertyType', 'bedrooms', 'coverageTypes', 'currentAddress', 'newAddress', 'movingDate', 'vehicleDetails', 'renewalDate', 'currentProvider'],
    spamKeywords: ['unsubscribe', 'invoice', 'newsletter'],
  },
  cleaning: {
    description: 'Cleaning services company',
    fields: ['serviceDate', 'propertyType', 'rooms', 'frequency', 'squareFeet'],
    spamKeywords: ['unsubscribe', 'invoice', 'newsletter'],
  },
  legal: {
    description: 'Law firm or legal services',
    fields: ['caseType', 'consultationDate', 'urgency', 'jurisdiction', 'hasRetainer'],
    spamKeywords: ['unsubscribe', 'newsletter', 'promotion'],
  },
  general: {
    description: 'General service business',
    fields: ['serviceRequired', 'preferredDate', 'budget', 'urgency'],
    spamKeywords: ['unsubscribe', 'newsletter'],
  },
}
