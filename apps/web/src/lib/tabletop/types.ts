export type TabletopExerciseStatus = "draft" | "scheduled" | "in_progress" | "completed";
export type TabletopScenarioType = "ransomware" | "supply_chain" | "insider" | "apt" | "nation_state" | "bcs";
export type TabletopDifficultyLevel = "beginner" | "intermediate" | "advanced";

export type TabletopSessionStatus = "scheduled" | "in_progress" | "completed";

export type TabletopFindingSeverity = "low" | "medium" | "high" | "critical";
export type TabletopFindingStatus = "open" | "in_progress" | "resolved";

export type TabletopGenerateInput = {
  title?: string;
  scenarioType: TabletopScenarioType;
  actorId?: string | null;
  actorMode?: "chosen" | "suggest";
  difficultyLevel: TabletopDifficultyLevel;
  durationMinutes: number;
  complianceTag?: string | null;
};

export type TabletopAiInject = {
  title: string;
  tPlus: number;
  situation: string;
  techniqueId?: string | null;
  questions: string[];
  criteria: string[];
  curveballs?: string[] | null;
  facilitatorTips?: string | null;
};

export type TabletopAiRole = {
  roleName: string;
  briefing: string;
  responsibilities: string[];
  documentsToHave: string[];
};

export type TabletopAiOutput = {
  narrative: string;
  facilitatorGuide: string;
  injects: TabletopAiInject[];
  roles: TabletopAiRole[];
  aarTemplate: string;
};

