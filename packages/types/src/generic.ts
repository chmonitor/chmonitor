// https://stackoverflow.com/a/54178819
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>

// https://stackoverflow.com/a/49286056
export type ValueOf<T> = T[keyof T]
