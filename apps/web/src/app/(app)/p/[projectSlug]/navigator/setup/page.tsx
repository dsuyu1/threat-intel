export const runtime = "edge";

import { getDb, kgEntities, navigatorConfigs, userStack } from "@ti/db";
import { asc, eq } from "drizzle-orm";
import { NavigatorSetupForm } from "../../../../../../components/navigator/NavigatorSetupForm";
import { hasNavigatorAccess } from "../../../../../../lib/local-user";
import { getViewerContext } from "../../../../../../lib/tenancy";

export default async function NavigatorSetupPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const db = getDb();
  const p = await params;
  const ctx = await getViewerContext({ projectSlug: p.projectSlug });
  const access = hasNavigatorAccess({ tier: ctx.user.tier });

  if (!access) {
    return (
      <div className="max-w-[90ch] mx-auto px-8 py-12">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Navigator</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Navigator is available on Pro.
        </p>
      </div>
    );
  }

  const [configRow, stackRows, sectorRows] = await Promise.all([
    db
      .select({
        sector: navigatorConfigs.sector,
        riskAppetite: navigatorConfigs.riskAppetite,
        crownJewels: navigatorConfigs.crownJewels,
      })
      .from(navigatorConfigs)
      .where(eq(navigatorConfigs.projectId, ctx.project.id))
      .limit(1),
    db
      .select({ technology: userStack.technology, versionRange: userStack.versionRange })
      .from(userStack)
      .where(eq(userStack.projectId, ctx.project.id))
      .orderBy(asc(userStack.technology)),
    db
      .select({ id: kgEntities.entityId, name: kgEntities.name })
      .from(kgEntities)
      .where(eq(kgEntities.kind, "sector"))
      .orderBy(asc(kgEntities.name))
      .limit(200),
  ]);

  const config = configRow?.[0] ?? { sector: "all", riskAppetite: "balanced" as any, crownJewels: null };

  return (
    <NavigatorSetupForm
      projectSlug={p.projectSlug}
      sectorOptions={[{ id: "all", name: "All sectors" }, ...sectorRows]}
      initial={{
        sector: config.sector,
        riskAppetite: config.riskAppetite as any,
        crownJewels: config.crownJewels,
        stack: stackRows,
      }}
    />
  );
}
