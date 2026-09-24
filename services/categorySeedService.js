import categoryModel from "../model/category.js";

/**
 * Give a brand-new shop a usable category list straight away, so the owner's
 * first product does not force them to invent a taxonomy.
 */
export const seedStarterCategories = async (userId, profile) => {
    try {
        const existing = await categoryModel.countDocuments({ userId });

        if (existing > 0) return;

        await categoryModel.insertMany(
            profile.defaultCategories.map((categoryName) => ({
                categoryName,
                description: `Starter category for ${profile.label}`,
                userId
            }))
        );
    } catch (error) {
        // Seeding is a convenience — never fail registration over it.
        console.log("Category seeding skipped:", error.message);
    }
};
