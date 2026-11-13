/* eslint-disable */
  /**
   * Generated `api` utility.
   *
   * THIS CODE IS AUTOMATICALLY GENERATED.
   *
   * To regenerate, run `npx convex dev`.
   * @module
   */
  
  import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
  import type * as admin from "../admin.js";
import type * as automation from "../automation.js";
import type * as http from "../http.js";
import type * as loans from "../loans.js";
import type * as notifications from "../notifications.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

  /**
   * A utility for referencing Convex functions in your app's API.
   *
   * Usage:
   * ```js
   * const myFunctionReference = api.myModule.myFunction;
   * ```
   */
  declare const fullApi: ApiFromModules<{
    "admin": typeof admin,
"automation": typeof automation,
"http": typeof http,
"loans": typeof loans,
"notifications": typeof notifications,
"tools": typeof tools,
"users": typeof users,
  }>;
  export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
  export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
  