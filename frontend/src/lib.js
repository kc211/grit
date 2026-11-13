
const RAW_API = import.meta.env.VITE_API_URL || "";
const API =
  RAW_API && !/^https?:\/\//i.test(RAW_API) ? `https://${RAW_API}` : RAW_API;

async function request(path, options = {}) {
  const { signal, ...fetchOptions } = options;

  const res = await fetch(`${API}${path}`, {
    ...fetchOptions,
    signal,
    headers: {
      ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
      ...(fetchOptions.headers || {}),
    },
  });

  let data = {};
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    const error = new Error(
      data.detail ||
        data.message ||
        (res.status === 409
          ? "That time was just taken. Pick another slot."
          : "Request failed.")
    );
    error.status = res.status;
    throw error;
  }

  return data;
}

export const get = (path, options = {}) =>
  request(path, options);

export const post = (path, body = {}, options = {}) =>
  request(path, {
    ...options,
    method: "POST",
    body: JSON.stringify(body),
  });

export const ist = (value) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value)) + " IST";

export const dateInput = (d) => {
  const x = new Date(d);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(x);
};

export const localISO = (day, clock) => `${day}T${clock}:00+05:30`;
