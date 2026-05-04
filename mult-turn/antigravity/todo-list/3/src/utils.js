export const isLate = (date, completed) => {
  if (!date || completed) return false;
  const dueDate = new Date(date);
  dueDate.setHours(23, 59, 59, 999); // Task is late only after the day ends
  const today = new Date();
  return today > dueDate;
};
