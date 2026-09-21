/**
 * Business type profiles.
 *
 * StoreFlow is a single product that adapts to the kind of shop the owner runs.
 * Everything that used to be hard-coded for a pharmacy (expiry tracking, drug
 * licence, "medicines") now lives here as one profile among many.
 *
 * The frontend keeps a richer copy of this registry in
 * `dashboard/src/config/businessTypes.js` (labels, icons, marketing copy).
 * This file holds only what the server needs: validation, defaults and seeds.
 * The `id` values MUST stay in sync between the two.
 */

const profile = ({
    id,
    label,
    itemLabel,
    itemLabelPlural,
    tracksExpiry = false,
    tracksBatch = false,
    licence = null,
    defaultUnit = "piece",
    units = ["piece", "box", "pack"],
    lowStockThreshold = 10,
    defaultTaxRate = 0,
    defaultCategories = []
}) => ({
    id,
    label,
    itemLabel,
    itemLabelPlural,
    tracksExpiry,
    tracksBatch,
    licence,
    defaultUnit,
    units,
    lowStockThreshold,
    defaultTaxRate,
    defaultCategories
});

export const BUSINESS_TYPES = [
    profile({
        id: "pharmacy",
        label: "Pharmacy / Medical Store",
        itemLabel: "Medicine",
        itemLabelPlural: "Medicines",
        tracksExpiry: true,
        tracksBatch: true,
        licence: {
            key: "licenseNumber",
            label: "Drug Licence No.",
            required: true
        },
        defaultUnit: "strip",
        units: ["strip", "bottle", "tube", "box", "piece", "vial", "sachet"],
        lowStockThreshold: 50,
        defaultTaxRate: 12,
        defaultCategories: [
            "Tablets",
            "Syrups",
            "Injections",
            "Ointments",
            "Drops",
            "Surgical",
            "Baby Care",
            "Supplements"
        ]
    }),

    profile({
        id: "grocery",
        label: "Grocery / Kirana Store",
        itemLabel: "Item",
        itemLabelPlural: "Items",
        tracksExpiry: true,
        tracksBatch: false,
        defaultUnit: "kg",
        units: ["kg", "g", "litre", "ml", "piece", "packet", "dozen", "bag"],
        lowStockThreshold: 20,
        defaultTaxRate: 5,
        defaultCategories: [
            "Staples & Grains",
            "Pulses",
            "Spices",
            "Oils & Ghee",
            "Snacks",
            "Beverages",
            "Dairy",
            "Personal Care",
            "Household"
        ]
    }),

    profile({
        id: "hardware",
        label: "Hardware / Sanitary Store",
        itemLabel: "Item",
        itemLabelPlural: "Items",
        tracksExpiry: false,
        defaultUnit: "piece",
        units: ["piece", "metre", "foot", "kg", "box", "bundle", "roll", "set"],
        lowStockThreshold: 10,
        defaultTaxRate: 18,
        defaultCategories: [
            "Plumbing",
            "Electrical",
            "Paints",
            "Tools",
            "Fasteners",
            "Sanitaryware",
            "Adhesives",
            "Safety"
        ]
    }),

    profile({
        id: "electronics",
        label: "Electronics / Appliances",
        itemLabel: "Product",
        itemLabelPlural: "Products",
        tracksExpiry: false,
        defaultUnit: "piece",
        units: ["piece", "box", "set", "pair"],
        lowStockThreshold: 5,
        defaultTaxRate: 18,
        defaultCategories: [
            "Televisions",
            "Kitchen Appliances",
            "Fans & Coolers",
            "Audio",
            "Cables & Adapters",
            "Batteries",
            "Lighting"
        ]
    }),

    profile({
        id: "mobile",
        label: "Mobile & Accessories",
        itemLabel: "Product",
        itemLabelPlural: "Products",
        tracksExpiry: false,
        defaultUnit: "piece",
        units: ["piece", "box", "pair", "set"],
        lowStockThreshold: 5,
        defaultTaxRate: 18,
        defaultCategories: [
            "Smartphones",
            "Feature Phones",
            "Chargers",
            "Earphones",
            "Covers & Cases",
            "Screen Guards",
            "Power Banks",
            "Memory Cards"
        ]
    }),

    profile({
        id: "stationery",
        label: "Stationery & Books",
        itemLabel: "Item",
        itemLabelPlural: "Items",
        tracksExpiry: false,
        defaultUnit: "piece",
        units: ["piece", "packet", "dozen", "box", "ream", "set"],
        lowStockThreshold: 25,
        defaultTaxRate: 12,
        defaultCategories: [
            "Notebooks",
            "Pens & Pencils",
            "Files & Folders",
            "Art Supplies",
            "Office Supplies",
            "School Books",
            "Paper"
        ]
    }),

    profile({
        id: "clothing",
        label: "Clothing & Apparel",
        itemLabel: "Product",
        itemLabelPlural: "Products",
        tracksExpiry: false,
        defaultUnit: "piece",
        units: ["piece", "pair", "set", "metre", "dozen"],
        lowStockThreshold: 5,
        defaultTaxRate: 5,
        defaultCategories: [
            "Men's Wear",
            "Women's Wear",
            "Kids Wear",
            "Ethnic Wear",
            "Winter Wear",
            "Innerwear",
            "Accessories"
        ]
    }),

    profile({
        id: "footwear",
        label: "Footwear Store",
        itemLabel: "Product",
        itemLabelPlural: "Products",
        tracksExpiry: false,
        defaultUnit: "pair",
        units: ["pair", "piece", "box"],
        lowStockThreshold: 5,
        defaultTaxRate: 12,
        defaultCategories: [
            "Men's Footwear",
            "Women's Footwear",
            "Kids Footwear",
            "Sports Shoes",
            "Sandals & Slippers",
            "Formal Shoes"
        ]
    }),

    profile({
        id: "bakery",
        label: "Bakery / Sweets & Namkeen",
        itemLabel: "Item",
        itemLabelPlural: "Items",
        tracksExpiry: true,
        tracksBatch: true,
        defaultUnit: "kg",
        units: ["kg", "g", "piece", "box", "packet", "dozen"],
        lowStockThreshold: 15,
        defaultTaxRate: 5,
        defaultCategories: [
            "Breads",
            "Cakes & Pastries",
            "Cookies",
            "Sweets",
            "Namkeen",
            "Chocolates",
            "Beverages"
        ]
    }),

    profile({
        id: "cosmetics",
        label: "Cosmetics & Beauty",
        itemLabel: "Product",
        itemLabelPlural: "Products",
        tracksExpiry: true,
        tracksBatch: true,
        defaultUnit: "piece",
        units: ["piece", "bottle", "tube", "box", "packet", "ml", "g"],
        lowStockThreshold: 15,
        defaultTaxRate: 18,
        defaultCategories: [
            "Skin Care",
            "Hair Care",
            "Makeup",
            "Fragrances",
            "Bath & Body",
            "Men's Grooming",
            "Tools & Brushes"
        ]
    }),

    profile({
        id: "autoparts",
        label: "Auto Parts & Service",
        itemLabel: "Part",
        itemLabelPlural: "Parts",
        tracksExpiry: false,
        defaultUnit: "piece",
        units: ["piece", "set", "litre", "box", "pair", "metre"],
        lowStockThreshold: 5,
        defaultTaxRate: 18,
        defaultCategories: [
            "Engine Parts",
            "Brakes & Clutch",
            "Filters",
            "Lubricants",
            "Batteries",
            "Tyres & Tubes",
            "Electricals",
            "Body Parts"
        ]
    }),

    profile({
        id: "general",
        label: "General Store / Other",
        itemLabel: "Product",
        itemLabelPlural: "Products",
        tracksExpiry: false,
        defaultUnit: "piece",
        units: ["piece", "kg", "g", "litre", "ml", "packet", "box", "dozen", "metre", "pair", "set"],
        lowStockThreshold: 10,
        defaultTaxRate: 0,
        defaultCategories: [
            "General",
            "Household",
            "Personal Care",
            "Packaged Food",
            "Stationery",
            "Miscellaneous"
        ]
    })
];

export const DEFAULT_BUSINESS_TYPE = "general";

export const BUSINESS_TYPE_IDS = BUSINESS_TYPES.map((type) => type.id);

export const getBusinessType = (id) =>
    BUSINESS_TYPES.find((type) => type.id === id) ||
    BUSINESS_TYPES.find((type) => type.id === DEFAULT_BUSINESS_TYPE);

/** Every unit any profile allows — used for product-level validation. */
export const ALL_UNITS = [
    ...new Set(BUSINESS_TYPES.flatMap((type) => type.units))
];

/** True when this kind of shop needs a trade/drug licence number. */
export const requiresLicence = (id) =>
    Boolean(getBusinessType(id).licence?.required);
