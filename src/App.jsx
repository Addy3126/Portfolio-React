import Header from './components/Header/header'
import Navigation from './components/navigation/nav'
import Landing from './components/Landing/landing'
import About from './components/About/about';
import Footer from './components/Footer/footer';
import Projects from './components/Projects/projects';

function App() {
  return (
    <div className="App">
      <Header />
      <Navigation />
      <Landing />
      <About />
      <Projects />
      <Footer />
    </div>
  );
}

export default App;
