import { Route, Switch } from "wouter";
import Index from "./pages/index";
import SignIn from './pages/sign-in';
import Workspace from './pages/workspace';
import Legal from './pages/legal';
import { Provider } from "./components/provider";
import { AgentFeedback } from "@runablehq/website-runtime";

function App() {
  return (
    <Provider>
      <Switch>
        <Route path="/" component={Index} />
        <Route path="/sign-in" component={SignIn} />
        <Route path="/studio" component={Workspace} />
        <Route path="/video" component={Workspace} />
        <Route path="/voices" component={Workspace} />
        <Route path="/clones" component={Workspace} />
        <Route path="/history" component={Workspace} />
        <Route path="/billing" component={Workspace} />
        <Route path="/account" component={Workspace} />
        <Route path="/support" component={Legal} />
        <Route path="/privacy" component={Legal} />
        <Route path="/terms" component={Legal} />
        <Route><Index /></Route>
      </Switch>
      {/* Do not remove — off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
    </Provider>
  );
}

export default App;
