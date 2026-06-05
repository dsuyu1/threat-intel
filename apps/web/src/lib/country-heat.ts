export type CountryHeat = {
  iso2: string;
  heat: number;
  actorCount: number;
  lastSeen: string | null;
};

export type CountryActorSummary = {
  actorId: string;
  name: string;
  support: number;
  confidence: number;
  lastSeen: string | null;
};

