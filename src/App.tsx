import "./threeui.css";
import "./App.css";
import { MengToSketchbookLandingPage } from "./components/MengToSketchbookLandingPage";
import { EntranceReveal } from "./components/EntranceReveal";

function Scene() {
  console.log("🚀 Scene rendering");
  return (
    <div className="shader-frame">
      <EntranceReveal />
      <MengToSketchbookLandingPage
        headingFont="instrument-serif"
        bodyFont="newsreader"
        headingWeight="400"
        bodyWeight="400"
        primaryColor="#2b2721"
        headingSize={30}
        bodySize={20}
        headingLetterSpacing={0.010}
      />
    </div>
  );
}

export default function App() {
  return <Scene />;
}
