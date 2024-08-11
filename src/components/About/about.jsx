import React from 'react'
import './about.css'
import profileImg from '../../assets/poly.png'

const About = () => {
    return (
        <div className="about">
            <div className="aboutSecHeadingOuter">
                <div className="aboutSecHeading userSelectNone">
                    <li>ABOUT</li><li>ABOUT</li><li>ABOUT</li><li>ABOUT</li>
                    <li className="filledHeading">ABOUT</li>
                    <li>ABOUT</li><li>ABOUT</li><li>ABOUT</li><li>ABOUT</li>
                </div>
            </div>
            <div className="introSec">
                <div className="sectionTitle titleIntro userSelectNone">Who is this guy?</div>
                <img className="profileImage" src={profileImg} alt="It's supposed to be me."/>
                <div className="square"></div>
                <div className="introSecText">
                    <p> &emsp;&emsp;&emsp;&emsp;&emsp;&emsp;A random 21 year old on the internet studying at SRM University, Sonipat. Majoring in Data Science and Artificial Intelligence(Computer Science Engineering), with passion projects(for some reason) in Web Development, trying to drag along my major subjects. Super chill and open minded to various stuff, and incorporating anything that seems interesting and valuable. Major skills right now consists of HTML&CSS(along with Bootstrap/Tailwind), Javascript, React, Python and a little C(for the sake of it).</p>
                </div>
            </div>
            <div className='curve'>
                <div className='curveCon1'>
                    <div className='curve1'>
                        <div className='curveLine1'></div>
                    </div>
                </div>
                <div className='curveCon2'>
                    <div className='curve2'>
                        <div className='curveLine2'></div>
                    </div>
                </div>
            </div>
            
            <div className='skillSec'>
                <div className="sectionTitle titleSkill userSelectNone">What he knows.</div>
                <div className='skillCon'>
                    <li>HTML&CSS</li>
                    <li>Javascript</li>
                    <li>React</li>
                    <li>Node.js</li>
                    <li>Python </li>
                    <li>MongoDB</li>
                    <li>MySQL</li>
                </div>
            </div>
        </div>
  )
}

export default About
