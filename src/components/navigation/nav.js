import React from 'react'
import './nav.css'
const Nav = () => {
  return (
    <div className="navigation fadeoutLanding">
        <div className="navtextplaceholder">
            <div id="about" className="nav_text">About</div>
            <div id="projects" className="nav_text">Projects</div>
            <div id="contact" className="nav_text">Contact</div>
        </div>
    </div>
  )
}

export default Nav