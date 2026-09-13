import { db } from "@/lib/db";
import { badRequest, handle, num } from "@/lib/api";

/**
 * @openapi
 * /api/rfps/split-preview:
 *   post:
 *     summary: How a style selection divides into RFPs
 *     description: >
 *       Templates resolve at sub-department, inheriting from division and
 *       department; the first published template found wins. Where a selection
 *       resolves to more than one template, it becomes more than one RFP —
 *       shown before anything is committed, with the resolution path visible.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               styleIds: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: One group per resulting RFP }
 *       400: { description: No styles given }
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { styleIds?: string[] };
  const styleIds = body.styleIds ?? [];

  if (!styleIds.length) return badRequest("Select at least one style");

  return handle(async () => {
    const [styles, templates] = await Promise.all([
      db.style.findMany({
        where: { id: { in: styleIds } },
        select: {
          id: true,
          styleNumber: true,
          name: true,
          division: true,
          department: true,
          subDepartment: true,
          planUnits: true,
          baselineFob: true,
          _count: { select: { cleanSheets: true } },
        },
      }),
      db.template.findMany({ where: { published: true } }),
    ]);

    // Group by the template each style resolves to.
    const groups = new Map<
      string,
      {
        templateId: string;
        templateName: string;
        resolutionPath: string;
        styles: typeof styles;
      }
    >();

    const unresolved: typeof styles = [];

    for (const style of styles) {
      const template = resolveTemplate(style, templates);
      if (!template) {
        unresolved.push(style);
        continue;
      }

      const group = groups.get(template.id);
      if (group) {
        group.styles.push(style);
      } else {
        groups.set(template.id, {
          templateId: template.id,
          templateName: template.name,
          // Shown explicitly, so the user can see WHY a style landed where it
          // did rather than trusting an invisible rule.
          resolutionPath: [
            template.division ?? "*",
            template.department ?? "*",
            template.subDepartment ?? "*",
          ].join(" › "),
          styles: [style],
        });
      }
    }

    return {
      totalStyles: styles.length,
      rfpCount: groups.size,
      groups: [...groups.values()].map((g) => ({
        templateId: g.templateId,
        templateName: g.templateName,
        resolutionPath: g.resolutionPath,
        // The name the system suggests. Editable, and must be set before an
        // invitation goes out.
        suggestedName: `${g.templateName} — Wave 2`,
        styleCount: g.styles.length,
        annualSpend: g.styles.reduce(
          (total, s) => total + (s.planUnits ?? 0) * (num(s.baselineFob) ?? 0),
          0,
        ),
        styles: g.styles.map((s) => ({
          id: s.id,
          styleNumber: s.styleNumber,
          name: s.name,
          subDepartment: s.subDepartment,
          planUnits: s.planUnits,
          baselineFob: num(s.baselineFob),
          // Readiness — displayed, not enforced, in the prototype.
          hasBaseline: num(s.baselineFob) !== null,
          hasCleanSheet: s._count.cleanSheets > 0,
        })),
      })),
      unresolved: unresolved.map((s) => ({
        id: s.id,
        styleNumber: s.styleNumber,
        name: s.name,
      })),
    };
  });
}

/**
 * Resolution: sub-department first, then department, then division. A template
 * with a null level matches any value at that level, which is how two seeded
 * templates cover every sub-department beneath them.
 */
function resolveTemplate(
  style: { division: string; department: string; subDepartment: string },
  templates: {
    id: string;
    name: string;
    division: string | null;
    department: string | null;
    subDepartment: string | null;
  }[],
) {
  const matches = templates.filter(
    (t) =>
      (!t.division || t.division === style.division) &&
      (!t.department || t.department === style.department) &&
      (!t.subDepartment || t.subDepartment === style.subDepartment),
  );

  if (!matches.length) return null;

  // Most specific wins.
  return matches.sort(
    (a, b) => specificity(b) - specificity(a),
  )[0];
}

function specificity(t: {
  division: string | null;
  department: string | null;
  subDepartment: string | null;
}): number {
  return (
    (t.division ? 1 : 0) + (t.department ? 1 : 0) + (t.subDepartment ? 1 : 0)
  );
}
