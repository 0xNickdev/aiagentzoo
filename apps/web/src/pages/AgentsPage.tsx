import AgentOfWeek from "../components/AgentOfWeek";
import Leaderboard from "../components/Leaderboard";
import BeaverRecord from "../components/BeaverRecord";
import KoiSection from "../components/KoiSection";
import Guests from "../components/Guests";
import Developers from "../components/Developers";
import Keeper from "../components/Keeper";

/** /agents: this week's contest, the leaderboard, the zoo's own judges and the guest wings. */
export default function AgentsPage() {
  return (
    <>
      <AgentOfWeek />
      <Leaderboard />
      <BeaverRecord />
      <KoiSection />
      <Guests />
      <Developers />
      <Keeper />
    </>
  );
}
