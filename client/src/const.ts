export { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";

// Returns the path shown when user is unauthenticated.
// "/" shows the login form (DashboardLayout renders it when user is null).
export const getLoginUrl = () => "/";
