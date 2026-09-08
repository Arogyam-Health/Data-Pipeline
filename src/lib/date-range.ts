/** Convert inclusive date-picker calendar dates into an India-local timestamp range. */
export function datePickerRangeToTimestamps(fromDate: string, toDate: string, offset = "+05:30") {
  const from = new Date(`${fromDate}T00:00:00${offset}`);
  const exclusiveTo = new Date(`${toDate}T00:00:00${offset}`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(exclusiveTo.getTime())) {
    throw new Error("Invalid date-picker range");
  }
  // The date picker is inclusive: the selected end date runs through its
  // final millisecond (the following IST midnight minus 1 ms).
  exclusiveTo.setTime(exclusiveTo.getTime() + 86400000);
  return {
    from: from.toISOString(),
    // The API and SQL functions use an inclusive upper bound.
    to: new Date(exclusiveTo.getTime() - 1).toISOString(),
  };
}
