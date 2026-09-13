import type { PrismaClient } from "@prisma/client";
import { step } from "./lib";

/**
 * The two real bid templates, transcribed from the vendor-filled files.
 *
 * They are genuinely different — verified in the cells:
 *   Ponte    crafting = hourly wage / 60 * SUM(cutting, sewing, finishing SAM)
 *   Percale  crafting = direct labor rate (CPM) / line efficiency * SAM
 * and their material formulas differ too. Both roll up to the SAME FOB:
 * SUM(material, trim, packaging, crafting, overhead). That identity is why
 * comparison runs on bucket totals and never on line items.
 *
 * Formulas are named per category and evaluated in domain/quote.ts. Structure
 * lives here as data so the form renders from the template.
 */

type Line = {
  key: string;
  label: string;
  help?: string;
  unit?: string;
  inputType: "text" | "number" | "currency" | "percent" | "days" | "minutes";
  derived?: boolean;
};

type Section = {
  key: string;
  label: string;
  lines: Line[];
  totalKey: string;
};

const PONTE_SECTIONS: Section[] = [
  {
    key: "BASE_MATERIALS",
    label: "1. Base Material",
    totalKey: "totalMaterialCost",
    lines: [
      { key: "coreMaterial", label: "Core Material", help: "Name of core material", inputType: "text" },
      { key: "uom", label: "Unit of Measure (UoM)", help: "e.g. meters (m), kilogram (kg), yard (yd)", inputType: "text" },
      { key: "consumption", label: "Volume / Consumption", help: "Amount of core material used in production", inputType: "number" },
      { key: "costPerUom", label: "Cost per UoM", help: "Cost the core material was purchased at", unit: "USD", inputType: "currency" },
      { key: "wastageGrading", label: "Wastage (Size Grading)", help: "% of wastage due to cutting different pattern sizes", unit: "%", inputType: "percent" },
      { key: "wastageProduction", label: "Wastage (Production)", help: "% of wastage across the whole production process", unit: "%", inputType: "percent" },
      { key: "coreMaterialCost", label: "Core Material Cost", unit: "USD", inputType: "currency", derived: true },
      { key: "otherMaterialsDescription", label: "Other Materials Description", inputType: "text" },
      { key: "otherMaterialsCost", label: "Other Materials Cost", unit: "USD", inputType: "currency" },
      { key: "totalMaterialCost", label: "Total Material Cost", unit: "USD", inputType: "currency", derived: true },
      { key: "materialLeadTime", label: "Core Material Order Lead Time", help: "Average working days (Mon-Sat) for inbound core material", unit: "Days", inputType: "days" },
    ],
  },
  {
    key: "TRIM_HARDWARE",
    label: "2. Trim + Hardware",
    totalKey: "totalTrimCost",
    lines: [
      ...["zipper", "buttons", "elastic", "interlining", "sewingThread", "cord", "label", "hangtag", "glue"].map(
        (key): Line => ({
          key,
          label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
          help: "Cost associated with the product",
          unit: "USD",
          inputType: "currency",
        }),
      ),
      { key: "otherTrimDescription", label: "Other Trim + Hardware Description", inputType: "text" },
      { key: "otherTrimCost", label: "Other Trim + Hardware Cost", unit: "USD", inputType: "currency" },
      { key: "totalTrimCost", label: "Total Trim + Hardware Cost", unit: "USD", inputType: "currency", derived: true },
    ],
  },
  {
    key: "PACKAGING",
    label: "3. Packaging",
    totalKey: "totalPackagingCost",
    lines: [
      { key: "polyBag", label: "Poly Bag", unit: "USD", inputType: "currency" },
      { key: "tissueBag", label: "Tissue Bag", unit: "USD", inputType: "currency" },
      { key: "box", label: "Box", unit: "USD", inputType: "currency" },
      { key: "desiccant", label: "Desiccant", unit: "USD", inputType: "currency" },
      { key: "otherPackagingDescription", label: "Other Packaging Description", inputType: "text" },
      { key: "otherPackagingCost", label: "Other Packaging Cost", unit: "USD", inputType: "currency" },
      { key: "totalPackagingCost", label: "Total Packaging Cost", unit: "USD", inputType: "currency", derived: true },
    ],
  },
  {
    key: "CRAFTING",
    label: "4. Crafting",
    totalKey: "totalCraftingCost",
    lines: [
      { key: "hourlyWage", label: "Direct Hourly Wages", help: "Production labor rate. Do NOT include overhead", unit: "USD", inputType: "currency" },
      { key: "cuttingSam", label: "Cutting SAM / SMV", help: "Total labor minutes spent cutting 1 unit", unit: "Minutes", inputType: "minutes" },
      { key: "sewingSam", label: "Sewing SAM / SMV", help: "Total labor minutes spent sewing 1 unit", unit: "Minutes", inputType: "minutes" },
      { key: "finishingSam", label: "Finishing SAM / SMV", help: "Total labor minutes spent finishing 1 unit", unit: "Minutes", inputType: "minutes" },
      { key: "totalSam", label: "Total SAM / SMV", unit: "Minutes", inputType: "minutes", derived: true },
      { key: "coreCraftingCost", label: "Core Crafting Cost", unit: "USD", inputType: "currency", derived: true },
      { key: "washCost", label: "Wash Cost", unit: "USD", inputType: "currency" },
      { key: "otherCraftingDescription", label: "Other Crafting Description", inputType: "text" },
      { key: "otherCraftingCost", label: "Other Crafting Cost", unit: "USD", inputType: "currency" },
      { key: "totalCraftingCost", label: "Total Crafting Cost", unit: "USD", inputType: "currency", derived: true },
    ],
  },
  {
    key: "OVERHEAD_SGA_PROFIT",
    label: "5. Overhead + SG&A + Profit",
    totalKey: "overheadCost",
    lines: [
      { key: "overheadCost", label: "Overhead + SG&A + Profit", help: "Factory overhead plus corporate overhead and profit margin", unit: "USD", inputType: "currency" },
      { key: "overheadPercent", label: "% Overhead + SG&A + Profit", unit: "%", inputType: "percent", derived: true },
      { key: "productLeadTime", label: "Product Lead Time", unit: "Days", inputType: "days" },
    ],
  },
];

const PERCALE_SECTIONS: Section[] = [
  {
    key: "BASE_MATERIALS",
    label: "1. Base Material",
    totalKey: "totalMaterialCost",
    lines: [
      { key: "fabric", label: "Fabric", help: "Fabric material", inputType: "text" },
      { key: "fabricWidth", label: "Fabric width", help: "Fabric width in meters", unit: "Meters", inputType: "number" },
      { key: "consumption", label: "Fabric consumption", help: "Amount of core material used in production", unit: "Meters", inputType: "number" },
      { key: "greyCostPerMeter", label: "Grey fabric cost per meter", unit: "USD", inputType: "currency" },
      { key: "dyeingCostPerMeter", label: "Dyeing and finishing cost per meter", unit: "USD", inputType: "currency" },
      { key: "printingCostPerMeter", label: "Printing cost per meter (if applicable)", unit: "USD", inputType: "currency" },
      { key: "wastage", label: "Wastage", help: "Fabric wastage", unit: "%", inputType: "percent" },
      { key: "totalFabricCost", label: "Total fabric cost", unit: "USD", inputType: "currency", derived: true },
      { key: "otherMaterialsDescription", label: "Other Materials Description", inputType: "text" },
      { key: "otherMaterialsCost", label: "Other Materials Cost", help: "Cost per unit", unit: "USD", inputType: "currency" },
      { key: "totalMaterialCost", label: "Total Material Cost", unit: "USD", inputType: "currency", derived: true },
      { key: "materialSourceVendor", label: "Core Material Source (Vendor Name)", inputType: "text" },
      { key: "materialSourceCountry", label: "Core Material Source Location (Country)", inputType: "text" },
      { key: "materialLeadTime", label: "Core Material Order Lead Time", unit: "Days", inputType: "days" },
    ],
  },
  {
    key: "TRIM_HARDWARE",
    label: "2. Trim + Hardware",
    totalKey: "totalTrimCost",
    lines: [
      { key: "sewingThread", label: "Sewing Thread", unit: "USD", inputType: "currency" },
      { key: "buttons", label: "Buttons", unit: "USD", inputType: "currency" },
      { key: "elastic", label: "Elastic", unit: "USD", inputType: "currency" },
      { key: "mainLabel", label: "Main Label", unit: "USD", inputType: "currency" },
      { key: "hangTags", label: "Hang tags with string", unit: "USD", inputType: "currency" },
      { key: "sizeLabel", label: "Size label", unit: "USD", inputType: "currency" },
      { key: "washCareLabel", label: "Wash Care Label", unit: "USD", inputType: "currency" },
      { key: "otherTrimDescription", label: "Other Description", inputType: "text" },
      { key: "otherTrimCost", label: "Other Cost", unit: "USD", inputType: "currency" },
      { key: "totalTrimCost", label: "Total Trim + Hardware Cost", unit: "USD", inputType: "currency", derived: true },
    ],
  },
  {
    key: "PACKAGING",
    label: "3. Packaging",
    totalKey: "totalPackagingCost",
    lines: [
      { key: "polyBag", label: "Poly Bag", unit: "USD", inputType: "currency" },
      { key: "cartonBox", label: "Carton Box", help: "Divide cost per carton by the number of units per carton", unit: "USD", inputType: "currency" },
      { key: "cottonRibbon", label: "Cotton Ribbon", unit: "USD", inputType: "currency" },
      { key: "otherPackagingDescription", label: "Other Description", inputType: "text" },
      { key: "otherPackagingCost", label: "Other Cost", unit: "USD", inputType: "currency" },
      { key: "totalPackagingCost", label: "Total Packaging Cost", unit: "USD", inputType: "currency", derived: true },
    ],
  },
  {
    key: "CRAFTING",
    label: "4. Crafting",
    totalKey: "totalCraftingCost",
    lines: [
      { key: "directLaborRate", label: "Direct Labor Rate", help: "Cost per production labor minute (CPM). Do not include overhead labor", unit: "USD", inputType: "currency" },
      { key: "lineEfficiency", label: "Line efficiency", help: "Total operating minutes of the line / total available minutes", unit: "%", inputType: "percent" },
      { key: "sam", label: "SAM / SMV", help: "Labor minutes to make 1 unit", unit: "Minutes", inputType: "minutes" },
      { key: "coreCraftingCost", label: "Core Crafting Cost", unit: "USD", inputType: "currency", derived: true },
      { key: "embellishingCost", label: "Embellishing cost (if applicable)", unit: "USD", inputType: "currency" },
      { key: "otherCraftingDescription", label: "Other Crafting Description", inputType: "text" },
      { key: "otherCraftingCost", label: "Other Crafting Cost", unit: "USD", inputType: "currency" },
      { key: "totalCraftingCost", label: "Total Crafting Cost", unit: "USD", inputType: "currency", derived: true },
    ],
  },
  {
    key: "OVERHEAD_SGA_PROFIT",
    label: "5. Overhead + SG&A + Profit",
    totalKey: "overheadCost",
    lines: [
      { key: "overheadCost", label: "Overhead + SG&A + Profit", unit: "USD", inputType: "currency" },
      { key: "overheadPercent", label: "% Overhead + SG&A + Profit", unit: "%", inputType: "percent", derived: true },
      { key: "productLeadTime", label: "Product Lead Time", unit: "Days", inputType: "days" },
    ],
  },
];

/** Commercial terms. Never summed into FOB (Build Doc 3.3). */
const ADDITIONAL_INFORMATION = [
  { key: "maxVolumeCapacity", label: "Maximum Volume Capacity", help: "How many annual units could you produce?", unit: "Units", inputType: "number" },
  { key: "productionLeadTime", label: "Production Lead Time", help: "Weeks to create product after material is received", unit: "Weeks", inputType: "number" },
  { key: "moq", label: "MOQ (if required)", help: "We expect no minimum order quantity. Please let us know of any constraints.", unit: "Units", inputType: "number" },
  { key: "additionalNotes", label: "Additional Notes", inputType: "text" },
];

export async function seedTemplates(db: PrismaClient) {
  const percale = await db.template.create({
    data: {
      name: "Home Bedding — Percale",
      division: "Home",
      department: "Bedding",
      subDepartment: null, // resolves for every bedding sub-department
      definition: {
        productAxis: "style_size",
        craftingFormula: "CPM_OVER_EFFICIENCY",
        materialFormula: "ADDITIVE_PER_METER",
        currency: "USD",
        sections: PERCALE_SECTIONS,
        additionalInformation: ADDITIONAL_INFORMATION,
        freight: {
          incoterms: ["VDDP", "QDDP"],
          destinations: ["US_CENTRAL"],
          modes: ["AIR", "OCEAN"],
        },
      } as never,
    },
  });

  const ponte = await db.template.create({
    data: {
      name: "Women's Bottoms — Ponte",
      division: "Womens",
      department: "Bottoms",
      subDepartment: null,
      definition: {
        productAxis: "style",
        craftingFormula: "HOURLY_OVER_60",
        materialFormula: "COST_PER_UOM",
        currency: "USD",
        sections: PONTE_SECTIONS,
        // Ponte has no Additional Information section — lead times live inside
        // the cost sections instead.
        additionalInformation: null,
        freight: {
          incoterms: ["VDDP"],
          destinations: ["US_WEST", "US_CENTRAL", "US_EAST"],
          modes: ["AIR", "SHIP"],
        },
      } as never,
    },
  });

  step(`2 templates: ${percale.name}, ${ponte.name}`);
  return { percale, ponte };
}
