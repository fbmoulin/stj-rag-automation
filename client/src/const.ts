export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Returns the path shown when user is unauthenticated.
// "/" shows the login form (DashboardLayout renders it when user is null).
export const getLoginUrl = () => "/";
