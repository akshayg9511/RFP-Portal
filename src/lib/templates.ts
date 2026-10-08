/**
 * Which quotation template a style resolves to.
 *
 * Resolution: sub-department first, then department, then division. A template
 * with a null level matches any value at that level, which is how two seeded
 * templates cover every sub-department beneath them. Most specific wins.
 *
 * Shared by the create-time split preview and by "Add products" on a draft
 * RFP, so both decide membership the same way.
 */
export type TemplateScope = {
  id: string;
  name: string;
  division: string | null;
  department: string | null;
  subDepartment: string | null;
};

export function resolveTemplate<T extends TemplateScope>(
  style: { division: string; department: string; subDepartment: string },
  templates: T[],
): T | null {
  const matches = templates.filter(
    (t) =>
      (!t.division || t.division === style.division) &&
      (!t.department || t.department === style.department) &&
      (!t.subDepartment || t.subDepartment === style.subDepartment),
  );
  if (!matches.length) return null;
  return matches.sort((a, b) => specificity(b) - specificity(a))[0];
}

function specificity(t: TemplateScope): number {
  return (t.division ? 1 : 0) + (t.department ? 1 : 0) + (t.subDepartment ? 1 : 0);
}
