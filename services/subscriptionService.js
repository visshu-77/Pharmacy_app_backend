export const calculateEndDate = (startDate, duration) => {
    const endDate = new Date(startDate);
    if (duration === "monthly") {
        endDate.setMonth(
            endDate.getMonth() + 1
        );
    } else if (duration === "sixMonths") {
        endDate.setMonth(
            endDate.getMonth() + 6
        );
    } else if (duration === "yearly") {
        endDate.setFullYear(
            endDate.getFullYear() + 1
        );
    }
    return endDate;
};