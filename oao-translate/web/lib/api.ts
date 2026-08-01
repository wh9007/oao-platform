export async function fetchSocketToken() {
  const response = await fetch("/api/token", { method:"POST", credentials:"include" });
  if (!response.ok) throw new Error("Unable to obtain translation session token");
  const data = await response.json() as { token:string };
  return data.token;
}
